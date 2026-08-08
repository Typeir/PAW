/**
 * @fileoverview Integration coverage for the daemon startup composition. One run
 * uses the real defaults (random token, in-memory store) and drives the loop
 * through the thin client to prove startEnforcement stands a working daemon end
 * to end, including that an edit to an ignored path is skipped. A second run
 * injects the seams and asserts the token file it wrote. So `pawdStart.ts`
 * reaches 100%.
 *
 * @module @paw/cli/test/e2e/pawdStart.integration
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryStore } from '@paw/adapters';
import { socketPath, tokenPath } from '@paw/daemon';
import type { SocketServerHandle } from '@paw/daemon';
import { startEnforcement } from '../../src/pawdStart.js';
import { runHook } from '../../src/hook.js';

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

/** A project root with a gate and sources. */
function project(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  mkdirSync(path.join(root, '.paw', 'gates'), { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, '.paw', 'gates', 'no-bad.gate.mjs'), NO_BAD);
  writeFileSync(path.join(root, 'src', 'x.ts'), 'export const x = 1; // BADCODE\n');
  writeFileSync(path.join(root, 'src', 'other.ts'), 'export const y = 2;\n');
  return root;
}

const endpointOf = (root: string) =>
  socketPath(root, { platform: process.platform, xdgRuntimeDir: undefined, tmpdir: root });

/** Run the thin client once against a root's daemon and return the parsed output. */
async function hook(root: string, event: string, file: string): Promise<Record<string, unknown>> {
  const out: string[] = [];
  await runHook({
    host: 'copilot',
    event,
    socketPath: endpointOf(root),
    tokenPath: tokenPath(path.join(root, '.paw')),
    io: {
      readStdin: async () => JSON.stringify({ session_id: 'S', toolName: 'edit', toolInput: { filePath: file } }),
      writeStdout: (t) => out.push(t),
    },
  });
  return JSON.parse(out[0]) as Record<string, unknown>;
}

let live: string;
let liveHandle: SocketServerHandle;

beforeAll(async () => {
  live = project('paw-start-');
  liveHandle = await startEnforcement(live);
});

afterAll(async () => {
  await liveHandle.close();
  rmSync(live, { recursive: true, force: true });
});

describe('startEnforcement', () => {
  it('stands a working daemon with real defaults and skips ignored paths', async () => {
    expect(await hook(live, 'tool.post', 'src/x.ts')).toMatchObject({ decision: 'block' });
    expect(((await hook(live, 'tool.pre', 'src/other.ts')).hookSpecificOutput as Record<string, unknown>).permissionDecision).toBe('deny');
    expect(await hook(live, 'tool.post', '.paw/config.json')).toEqual({ continue: true });
  });

  it('writes the token from the injected seam', async () => {
    const root = project('paw-start2-');
    const handle = await startEnforcement(root, { randomToken: () => 'FIXED-TOKEN', makeStore: createMemoryStore });
    try {
      expect(readFileSync(tokenPath(path.join(root, '.paw')), 'utf8')).toBe('FIXED-TOKEN');
      expect(await hook(root, 'tool.pre', 'src/other.ts')).toEqual({ continue: true });
    } finally {
      await handle.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
