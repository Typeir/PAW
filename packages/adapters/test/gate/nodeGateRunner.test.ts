/**
 * @fileoverview Unit tests for the node gate runner against a real, written-out
 * project: `.paw/gates/*.gate.mjs` modules and source files in a temp dir. They
 * pin real discovery, dynamic loading, the single-file context (targetFiles /
 * cached readFile / git), a clean pass, a critical fail with a located finding, a
 * warning that does not fail the run, a skipped non-gate module, a contained
 * throw, and an absent gates dir. Temp dirs are unique per run, so dynamic import
 * never collides.
 *
 * @module @paw/adapters/test/gate/nodeGateRunner
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNodeGateRunner } from '../../src/index.js';

const NO_BAD = `export const gate = {
  id: 'no-bad', name: 'No BADCODE', port: 'code-quality',
  severity: 'critical', appliesTo: ['.ts'],
  async check(ctx) {
    const findings = [];
    for (const file of await ctx.targetFiles(['.ts'])) {
      (await ctx.readFile(file)).split('\\n').forEach((l, i) => {
        if (l.includes('BADCODE')) findings.push({ file, line: i + 1, rule: 'no-bad', message: 'BADCODE is forbidden' });
      });
    }
    return { gate: 'no-bad', passed: findings.length === 0, severity: 'critical', findings, stats: { filesChecked: 1, findingsCount: findings.length, durationMs: 0 } };
  },
};
`;

const NO_TODO = `export const gate = {
  id: 'no-todo', name: 'No TODO', port: 'code-quality',
  severity: 'warning', appliesTo: ['.ts'],
  async check(ctx) {
    const findings = [];
    for (const file of await ctx.targetFiles(['.ts'])) {
      if ((await ctx.readFile(file)).includes('TODO')) findings.push({ file, rule: 'no-todo', message: 'leftover TODO', severity: 'warning' });
    }
    return { gate: 'no-todo', passed: findings.length === 0, severity: 'warning', findings, stats: { filesChecked: 1, findingsCount: findings.length, durationMs: 0 } };
  },
};
`;

const USES_GIT = `export const gate = {
  id: 'uses-git', name: 'Uses git', port: 'custom',
  severity: 'warning', appliesTo: ['.ts'],
  async check(ctx) {
    ctx.git('--version');
    return { gate: 'uses-git', passed: true, severity: 'warning', findings: [], stats: { filesChecked: 0, findingsCount: 0, durationMs: 0 } };
  },
};
`;

const BOOM = `export const gate = {
  id: 'boom', name: 'Boom', port: 'custom',
  severity: 'critical', appliesTo: ['.ts'],
  async check() { throw new Error('kaboom'); },
};
`;

const NO_EXPORT = `export const notGate = { id: 'nope' };\n`;

const NO_CHECK = `export const gate = { id: 'no-check', appliesTo: [] };\n`;

const MINIMAL = `export const gate = {
  id: 'minimal', name: 'Minimal', port: 'custom', severity: 'warning', appliesTo: ['.ts'],
  async check() { return { gate: 'minimal', passed: true, severity: 'warning' }; },
};
`;

const THROW_STR = `export const gate = {
  id: 'throwstr', name: 'Throws a string', port: 'custom', severity: 'critical', appliesTo: ['.ts'],
  async check() { throw 'plain-string-failure'; },
};
`;

let root: string;

/**
 * Write a gate module under a project's `.paw/gates`.
 *
 * @param proj - Absolute project root.
 * @param name - Gate file name.
 * @param body - Module source.
 */
function gate(proj: string, name: string, body: string): void {
  const dir = path.join(proj, '.paw', 'gates');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), body);
}

/**
 * Write a source file under a project's `src`.
 *
 * @param proj - Absolute project root.
 * @param name - File name.
 * @param body - File content.
 */
function src(proj: string, name: string, body: string): void {
  const dir = path.join(proj, 'src');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), body);
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'paw-gate-'));

  const main = path.join(root, 'main');
  gate(main, 'no-bad.gate.mjs', NO_BAD);
  gate(main, 'no-todo.gate.mjs', NO_TODO);
  gate(main, 'uses-git.gate.mjs', USES_GIT);
  src(main, 'clean.ts', 'export const ok = 1;\n');
  src(main, 'dirty.ts', 'export const bad = 1; // BADCODE and a TODO\n');

  gate(path.join(root, 'boom'), 'boom.gate.mjs', BOOM);

  const invalid = path.join(root, 'invalid');
  gate(invalid, 'no-export.gate.mjs', NO_EXPORT);
  gate(invalid, 'no-check.gate.mjs', NO_CHECK);

  const edge = path.join(root, 'edge');
  gate(edge, 'minimal.gate.mjs', MINIMAL);
  gate(edge, 'throwstr.gate.mjs', THROW_STR);

  mkdirSync(path.join(root, 'empty'), { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('createNodeGateRunner', () => {
  it('passes a clean file across every gate', async () => {
    const report = await createNodeGateRunner(path.join(root, 'main')).runForFiles(['src/clean.ts']);
    expect(report.overall).toBe('PASS');
    expect(report.summary.hasCritical).toBe(false);
    expect(report.summary.totalGates).toBe(3);
  });

  it('fails on BADCODE with a located critical finding, TODO only warns', async () => {
    const report = await createNodeGateRunner(path.join(root, 'main')).runForFiles(['src/dirty.ts']);
    expect(report.overall).toBe('FAIL');
    expect(report.summary.hasCritical).toBe(true);
    const bad = report.gates.find((g) => g.gate === 'no-bad');
    expect(bad?.findings[0]).toMatchObject({ file: 'src/dirty.ts', line: 1, rule: 'no-bad' });
    const todo = report.gates.find((g) => g.gate === 'no-todo');
    expect(todo).toMatchObject({ passed: false, severity: 'warning' });
  });

  it('skips a changed file that no longer exists instead of erroring on it', async () => {
    const report = await createNodeGateRunner(path.join(root, 'main')).runForFiles(['src/deleted.ts']);
    expect(report.overall).toBe('PASS');
    expect(report.summary.hasCritical).toBe(false);
    const errored = report.gates.some((g) => g.findings.some((f) => f.rule === 'gate-error'));
    expect(errored).toBe(false);
  });

  it('contains a throwing gate as a critical gate-error finding', async () => {
    const report = await createNodeGateRunner(path.join(root, 'boom')).runForFiles(['src/x.ts']);
    expect(report.overall).toBe('FAIL');
    expect(report.gates[0].findings[0]).toMatchObject({ rule: 'gate-error', message: 'kaboom' });
  });

  it('skips modules with no gate export and gates with no check', async () => {
    const report = await createNodeGateRunner(path.join(root, 'invalid')).runForFiles(['src/x.ts']);
    expect(report.summary.totalGates).toBe(0);
    expect(report.overall).toBe('PASS');
  });

  it('tolerates a result without findings or stats, and a non-Error throw', async () => {
    const report = await createNodeGateRunner(path.join(root, 'edge')).runForFiles(['src/x.ts']);
    const minimal = report.gates.find((g) => g.gate === 'minimal');
    expect(minimal).toMatchObject({ passed: true, findings: [] });
    expect(minimal?.stats.filesChecked).toBe(0);
    const thrown = report.gates.find((g) => g.gate === 'throwstr');
    expect(thrown?.findings[0]).toMatchObject({ rule: 'gate-error', message: 'plain-string-failure' });
  });

  it('returns an empty pass when there is no gates directory', async () => {
    const report = await createNodeGateRunner(path.join(root, 'empty')).runForFiles(['src/x.ts']);
    expect(report.gates).toHaveLength(0);
    expect(report.overall).toBe('PASS');
  });

  it('is bound to a git-capable root', () => {
    expect(execSync('git --version', { encoding: 'utf-8' })).toContain('git version');
  });
});
