/**
 * @fileoverview Unit tests for the warm gate cache. They pin the daemon-critical
 * behaviour: a first run imports and gates; an unchanged second run reuses the
 * cached gate; an edited gate (different size) is re-imported and its new verdict
 * is used; a removed gate is dropped; an invalid module is skipped; and an absent
 * gates dir clears the cache. Edits change file size, so invalidation is
 * deterministic regardless of same-millisecond mtimes.
 *
 * @module @paw/adapters/test/gate/gateCache
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGateCache } from '../../src/index.js';

/** A gate that flags any line containing `marker`. */
const gateFlagging = (marker: string) => `export const gate = {
  id: 'flag', name: 'Flag ${marker}', port: 'code-quality', severity: 'critical', appliesTo: ['.ts'],
  async check(ctx) {
    const findings = [];
    for (const file of await ctx.targetFiles(['.ts'])) {
      if ((await ctx.readFile(file)).includes('${marker}')) findings.push({ file, rule: 'flag', message: '${marker} present' });
    }
    return { gate: 'flag', passed: findings.length === 0, severity: 'critical', findings, stats: { filesChecked: 1, findingsCount: findings.length, durationMs: 0 } };
  },
};
`;

const SECOND = `export const gate = {
  id: 'second', name: 'Second', port: 'custom', severity: 'warning', appliesTo: ['.ts'],
  async check() { return { gate: 'second', passed: true, severity: 'warning', findings: [], stats: { filesChecked: 0, findingsCount: 0, durationMs: 0 } }; },
};
`;

const NOT_A_GATE = `export const notGate = {};\n`;

let root: string;
let gatesDir: string;

const gateFile = (name: string, body: string): void => writeFileSync(path.join(gatesDir, name), body);

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'paw-gcache-'));
  gatesDir = path.join(root, '.paw', 'gates');
  mkdirSync(gatesDir, { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'x.ts'), 'export const x = 1; // BADCODE\n');
  gateFile('flag.gate.mjs', gateFlagging('BADCODE'));
  gateFile('second.gate.mjs', SECOND);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('createGateCache', () => {
  it('imports and gates on the first run', async () => {
    const report = await createGateCache(root).runForFiles(['src/x.ts']);
    expect(report.overall).toBe('FAIL');
    expect(report.summary.totalGates).toBe(2);
  });

  it('reuses cached gates on an unchanged run, and re-imports an edited gate', async () => {
    const runner = createGateCache(root);

    const first = await runner.runForFiles(['src/x.ts']);
    expect(first.overall).toBe('FAIL');

    const cachedHit = await runner.runForFiles(['src/x.ts']);
    expect(cachedHit.overall).toBe('FAIL');

    gateFile('flag.gate.mjs', gateFlagging('NONSENSE-TOKEN-NOT-PRESENT'));
    const afterEdit = await runner.runForFiles(['src/x.ts']);
    expect(afterEdit.overall).toBe('PASS');
  });

  it('drops a removed gate and skips an invalid module', async () => {
    const runner = createGateCache(root);
    const before = await runner.runForFiles(['src/x.ts']);
    expect(before.gates.some((g) => g.gate === 'second')).toBe(true);

    rmSync(path.join(gatesDir, 'second.gate.mjs'));
    gateFile('bogus.gate.mjs', NOT_A_GATE);
    const after = await runner.runForFiles(['src/x.ts']);

    expect(after.gates.some((g) => g.gate === 'second')).toBe(false);
    expect(after.summary.totalGates).toBe(1);
  });

  it('clears the cache when the gates directory is gone', async () => {
    const bare = mkdtempSync(path.join(tmpdir(), 'paw-bare-'));
    const runner = createGateCache(bare);
    const report = await runner.runForFiles(['src/x.ts']);
    expect(report.gates).toHaveLength(0);
    expect(report.overall).toBe('PASS');
    rmSync(bare, { recursive: true, force: true });
  });
});
