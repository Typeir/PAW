/**
 * PAW Daemon Startup
 *
 * @fileoverview Composition brings one resident enforcement daemon up for one
 * project root. Assemble the daemon's components once — violation store, warm
 * gate cache, exempt-tool and ignore policy, host connectors, linter
 * connectors — write handshake token, serve them over socket via
 * {@link serveEnforcement} (doc 10 §2, §8). Invoked by an autostart spawn.
 *
 * Enabled linter connectors are read from `.paw/config.json` per run, so
 * enabling one in any surface takes effect on the next edit. Findings from the
 * detached whole-project run land straight in the store as deferred
 * violations, since they arrive long after their hook call answered.
 *
 * @module @paw/cli/application/pawdStart
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGateCache, createNodeConfigDocument, openSqlJsStore } from '@paw/adapters';
import { copilotHooksConnector } from '@paw/connectors';
import {
  enabledConnectorIds,
  lintViolation,
  toProjectRelative,
  type ConfigDocument,
  type DispatchHookDeps,
  type StorePort,
} from '@paw/core';
import {
  createLinterRunner,
  serveEnforcement,
  socketPath,
  tokenPath,
  type SocketServerHandle,
} from '@paw/daemon';

/**
 * Read-only tools never block by violations. Port from legacy `preToolUse`
 * hook.
 */
const EXEMPT_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'view_image',
  'grep_search',
  'file_search',
  'semantic_search',
  'list_dir',
  'get_errors',
  'get_terminal_output',
  'memory',
  'manage_todo_list',
  'vscode_askQuestions',
  'tool_search_tool_regex',
  'fetch_webpage',
  'task_complete',
]);

const IGNORED = /(^|\/)(\.paw|\.git|node_modules|dist|coverage|\.next)(\/|$)/;

/**
 * Injectable seams for testing.
 *
 * @interface StartSeams
 * @property {() => string} [randomToken] - Generate handshake token; default 32 random bytes hex.
 * @property {() => Promise<StorePort> | StorePort} [makeStore] - Build store; default disk-backed sql.js store under `.paw`.
 * @property {{ ms: number; onIdle: () => void }} [idle] - Close and signal after quiet period; omit to stay resident.
 * @property {{ pid: number; now: () => number; onStop: () => void }} [control] - Enable `daemon.status`/`daemon.stop`; pass through to service.
 * @property {() => Promise<ConfigDocument>} [readConfig] - Read the repo config, for enabled connectors; default the repo's `.paw/config.json`.
 */
export interface StartSeams {
  randomToken?: () => string;
  makeStore?: () => Promise<StorePort> | StorePort;
  idle?: { ms: number; onIdle: () => void };
  control?: { pid: number; now: () => number; onStop: () => void };
  readConfig?: () => Promise<ConfigDocument>;
}

/**
 * Bring enforcement up for project root, return running server.
 *
 * @param {string} root - Absolute project root.
 * @param {StartSeams} [seams] - Optional injectable seams.
 * @returns {Promise<SocketServerHandle>} Running daemon.
 */
export async function startEnforcement(
  root: string,
  seams: StartSeams = {},
): Promise<SocketServerHandle> {
  const pawDir = join(root, '.paw');
  const endpoint = socketPath(root, {
    platform: process.platform,
    xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
    tmpdir: tmpdir(),
  });
  return serveEnforcement({
    socketPath: endpoint,
    projectRoot: root,
    idle: seams.idle,
    control: seams.control,
    configure: async () => {
      mkdirSync(pawDir, { recursive: true });
      const token = (seams.randomToken ?? (() => randomBytes(32).toString('hex')))();
      writeFileSync(tokenPath(pawDir), token, { mode: 0o600 });
      const store = await (seams.makeStore ?? (() => openSqlJsStore(join(pawDir, 'paw.sqlite'))))();
      const readConfig =
        seams.readConfig ?? (() => createNodeConfigDocument(root).read());
      const deps: DispatchHookDeps = {
        store,
        gates: createGateCache(root),
        linters: createLinterRunner({
          root,
          enabled: async () => {
            try {
              return enabledConnectorIds(await readConfig());
            } catch {
              return [];
            }
          },
          onLate: (findings) => {
            void store.raise(findings.map(lintViolation), null).catch(() => undefined);
          },
        }),
        exemptTools: EXEMPT_TOOLS,
        isIgnored: (path) => IGNORED.test(path),
        toRelative: (path) => toProjectRelative(root, path),
        connectors: { copilot: copilotHooksConnector },
      };
      return { token, deps };
    },
  });
}
