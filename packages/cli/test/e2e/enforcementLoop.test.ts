/**
 * @fileoverview End-to-end proof of the whole stack as it actually runs: the thin
 * `paw hook` client talks over a real socket to a real resident daemon that owns
 * a real store, a real warm gate cache, and the real Copilot connector. Each step
 * is a separate client invocation (a fresh connection, as a real hook would be),
 * and the loop is driven through Copilot's own payloads and outputs: a bad edit
 * blocks, the violation denies other files via `permissionDecision` while
 * allowing the violated one, fixing it clears, the gate reopens. With the daemon
 * down, the client fails open.
 *
 * @module @paw/cli/test/e2e/enforcementLoop
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGateCache, createMemoryStore } from '@paw/adapters';
import { copilotHooksConnector } from '@paw/connectors';
import type { DispatchHookDeps } from '@paw/core';
import { serveEnforcement, socketPath, type SocketServerHandle } from '@paw/daemon';
import { runHook } from '../../src/application/hook.js';

const NO_BAD = `export const gate = {
  id: 'no-bad', name: 'No BADCODE', port: 'code-quality', severity: 'critical', appliesTo: ['.ts'],
  async check(ctx) {
    const findings = [];
    for (const file of await ctx.targetFiles(['.ts'])) {
      if ((await ctx.readFile(file)).includes('BADCODE')) findings.push({ file, rule: 'no-bad', message: 'BADCODE forbidden' });
    }
    return { gate: 'no-bad', passed: findings.length === 0, severity: 'critical', findings, stats: { filesChecked: 1, findingsCount: findings.length, durationMs: 0 } };
  },
};
`;

const TOKEN = 'daemon-token-value';
let root: string;
let endpoint: string;
let tokenFile: string;
let handle: SocketServerHandle;

/** Run the thin client once and return the parsed host output. */
async function hook(event: string, file: string, socket = endpoint): Promise<Record<string, unknown>> {
  const out: string[] = [];
  await runHook({
    host: 'copilot',
    event,
    socketPath: socket,
    tokenPath: tokenFile,
    io: {
      readStdin: async () => JSON.stringify({ session_id: 'S', toolName: 'edit', toolInput: { filePath: file } }),
      writeStdout: (t) => out.push(t),
    },
  });
  return JSON.parse(out[0]) as Record<string, unknown>;
}

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'paw-cli-e2e-'));
  mkdirSync(path.join(root, '.paw', 'gates'), { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, '.paw', 'gates', 'no-bad.gate.mjs'), NO_BAD);
  writeFileSync(path.join(root, 'src', 'x.ts'), 'export const x = 1; // BADCODE\n');
  writeFileSync(path.join(root, 'src', 'other.ts'), 'export const y = 2;\n');
  tokenFile = path.join(root, '.paw', 'daemon.token');
  writeFileSync(tokenFile, TOKEN);

  const deps: DispatchHookDeps = {
    store: createMemoryStore(),
    gates: createGateCache(root),
    exemptTools: new Set(['read_file']),
    isIgnored: () => false,
    connectors: { copilot: copilotHooksConnector },
  };
  endpoint = socketPath(root, { platform: process.platform, xdgRuntimeDir: undefined, tmpdir: root });
  handle = await serveEnforcement({
    socketPath: endpoint,
    projectRoot: root,
    configure: async () => ({ token: TOKEN, deps }),
  });
});

afterAll(async () => {
  await handle.close();
  rmSync(root, { recursive: true, force: true });
});

describe('paw hook client → pawd, end to end', () => {
  it('blocks a bad edit, gates other work until fixed, then reopens', async () => {
    const blocked = await hook('tool.post', 'src/x.ts');
    expect(blocked).toMatchObject({ continue: true, decision: 'block' });
    expect(String(blocked.reason)).toContain('BADCODE');

    const denied = await hook('tool.pre', 'src/other.ts');
    const deny = denied.hookSpecificOutput as Record<string, unknown>;
    expect(deny.permissionDecision).toBe('deny');
    expect(String(deny.permissionDecisionReason)).toContain('src/x.ts');

    expect(await hook('tool.pre', 'src/x.ts')).toEqual({ continue: true });

    writeFileSync(path.join(root, 'src', 'x.ts'), 'export const x = 1;\n');
    expect(await hook('tool.post', 'src/x.ts')).toEqual({ continue: true });
    expect(await hook('tool.pre', 'src/other.ts')).toEqual({ continue: true });
  });

  it('fails open to continue when no daemon is listening', async () => {
    const gone = socketPath(path.join(root, 'no-daemon-here'), {
      platform: process.platform,
      xdgRuntimeDir: undefined,
      tmpdir: root,
    });
    expect(await hook('tool.pre', 'src/other.ts', gone)).toEqual({ continue: true });
  });
});
