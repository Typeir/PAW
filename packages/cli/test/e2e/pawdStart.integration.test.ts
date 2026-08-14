/**
 * @fileoverview Test daemon startup composition. First run use real defaults
 * (random token, in-memory store) and drive loop through thin client; assert
 * startEnforcement stand working daemon end to end and skip edit to ignored
 * path. Second run inject seams and assert token file written. Cover
 * `pawdStart.ts` to 100%.
 *
 * @module @paw/cli/test/e2e/pawdStart.integration
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryStore } from '@paw/adapters';
import type { StorePort } from '@paw/core';
import { socketPath, tokenPath } from '@paw/daemon';
import type { SocketServerHandle } from '@paw/daemon';
import { startEnforcement } from '../../src/application/pawdStart.js';
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

/** Build project root with gate and sources. */
function project(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  mkdirSync(path.join(root, '.paw', 'gates'), { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, '.paw', 'gates', 'no-bad.gate.mjs'), NO_BAD);
  writeFileSync(
    path.join(root, 'src', 'x.ts'),
    'export const x = 1; // BADCODE\n',
  );
  writeFileSync(path.join(root, 'src', 'other.ts'), 'export const y = 2;\n');
  return root;
}

const endpointOf = (root: string) =>
  socketPath(root, {
    platform: process.platform,
    xdgRuntimeDir: undefined,
    tmpdir: root,
  });

/** Run thin client once against root's daemon and return parsed output. */
async function hook(
  root: string,
  event: string,
  file: string,
): Promise<Record<string, unknown>> {
  const out: string[] = [];
  await runHook({
    host: 'copilot',
    event,
    socketPath: endpointOf(root),
    tokenPath: tokenPath(path.join(root, '.paw')),
    io: {
      readStdin: async () =>
        JSON.stringify({
          session_id: 'S',
          toolName: 'edit',
          toolInput: { filePath: file },
        }),
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
    expect(await hook(live, 'tool.post', 'src/x.ts')).toMatchObject({
      decision: 'block',
    });
    expect(
      (
        (await hook(live, 'tool.pre', 'src/other.ts'))
          .hookSpecificOutput as Record<string, unknown>
      ).permissionDecision,
    ).toBe('deny');
    expect(await hook(live, 'tool.post', '.paw/config.json')).toEqual({
      continue: true,
    });
  });

  it('lands an enabled linter’s findings as deferred violations', async () => {
    const root = project('paw-start-lint-');
    // Stands in for the repo's own eslint: the runner executes each tool's JS
    // entry under node, so a fake entry proves the whole path on any platform.
    const entryDir = path.join(root, 'node_modules', 'eslint', 'bin');
    mkdirSync(entryDir, { recursive: true });
    const report = JSON.stringify([
      {
        filePath: 'src/other.ts',
        messages: [
          { ruleId: 'no-debugger', line: 2, message: 'Unexpected debugger' },
        ],
      },
    ]);
    writeFileSync(
      path.join(entryDir, 'eslint.js'),
      `console.log(${JSON.stringify(report)});\n`,
    );
    writeFileSync(
      path.join(root, '.paw', 'config.json'),
      JSON.stringify({ connectors: ['eslint'] }),
    );

    let store!: StorePort;
    const handle = await startEnforcement(root, {
      makeStore: async () => {
        store = await createMemoryStore();
        return store;
      },
    });
    try {
      expect(await hook(root, 'tool.post', 'src/other.ts')).toEqual({
        continue: true,
      });
      const outstanding = await store.outstanding();
      expect(outstanding).toEqual([
        expect.objectContaining({
          filePath: 'src/other.ts',
          rule: 'eslint/no-debugger',
          message: 'Unexpected debugger (line 2)',
          indirectFix: true,
        }),
      ]);
    } finally {
      await handle.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes the token from the injected seam', async () => {
    const root = project('paw-start2-');
    const handle = await startEnforcement(root, {
      randomToken: () => 'FIXED-TOKEN',
      makeStore: createMemoryStore,
    });
    try {
      expect(readFileSync(tokenPath(path.join(root, '.paw')), 'utf8')).toBe(
        'FIXED-TOKEN',
      );
      expect(await hook(root, 'tool.pre', 'src/other.ts')).toEqual({
        continue: true,
      });
    } finally {
      await handle.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
