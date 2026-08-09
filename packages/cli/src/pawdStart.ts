/**
 * PAW Daemon Startup
 *
 * @fileoverview The composition that brings a resident enforcement daemon up for
 * one project root: it assembles the pieces pawd owns once — the violation store,
 * the warm gate cache, the exempt-tool and ignore policy, and the host
 * connectors — writes the handshake token, and serves them over the socket via
 * {@link serveEnforcement} (doc 10 §2, §8). This is the target an autostart
 * spawns. The store defaults to in-memory: a long-lived owner already fixes the
 * race the cold hooks had; durable sql.js persistence across daemon restarts is
 * the remaining follow-up (doc 10 §8a).
 *
 * @module @paw/cli/pawdStart
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGateCache, openSqlJsStore } from '@paw/adapters';
import { copilotHooksConnector } from '@paw/connectors';
import { toProjectRelative, type DispatchHookDeps, type StorePort } from '@paw/core';
import { serveEnforcement, socketPath, tokenPath, type SocketServerHandle } from '@paw/daemon';

/**
 * Read-only tools never blocked by violations, ported from the legacy
 * `preToolUse` hook — the agent needs these to diagnose and fix.
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
 * @property {() => string} [randomToken] - Generate the handshake token; defaults to 32 random bytes hex.
 * @property {() => Promise<StorePort> | StorePort} [makeStore] - Build the store; defaults to the disk-backed sql.js store under `.paw`.
 * @property {{ ms: number; onIdle: () => void }} [idle] - Close and signal after this quiet period; omit to stay resident.
 * @property {{ pid: number; now: () => number; onStop: () => void }} [control] - Enables `daemon.status`/`daemon.stop`; passed through to the service.
 */
export interface StartSeams {
  randomToken?: () => string;
  makeStore?: () => Promise<StorePort> | StorePort;
  idle?: { ms: number; onIdle: () => void };
  control?: { pid: number; now: () => number; onStop: () => void };
}

/**
 * Bring enforcement up for a project root and return the running server.
 *
 * @param {string} root - Absolute project root.
 * @param {StartSeams} [seams] - Optional injectable seams.
 * @returns {Promise<SocketServerHandle>} The running daemon.
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
      const deps: DispatchHookDeps = {
        store,
        gates: createGateCache(root),
        exemptTools: EXEMPT_TOOLS,
        isIgnored: (path) => IGNORED.test(path),
        toRelative: (path) => toProjectRelative(root, path),
        connectors: { copilot: copilotHooksConnector },
      };
      return { token, deps };
    },
  });
}
