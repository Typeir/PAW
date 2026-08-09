/**
 * @fileoverview Unit tests for the post-tool detector. They pin the loop's
 * recording half: ignored/empty edits do nothing, a clean gate run clears stale
 * violations and stays silent, and a critical run clears then records the fresh
 * findings and returns a `block`. A fake store captures raise/resolve calls and a
 * fake runner returns canned reports, so every branch is exercised for 100%.
 *
 * @module @paw/core/test/application/checkEdit
 */

import { describe, expect, it } from 'vitest';
import {
  checkEdit,
  type GateResult,
  type GateRunner,
  type HealthReport,
  type StorePort,
  type ToolPostEvent,
  type Violation,
} from '../../src/index.js';

/**
 * A store fake that records what the detector raised and resolved.
 */
function fakeStore() {
  const raised: { violations: Violation[]; sessionId: string | null }[] = [];
  const resolved: { path: string; sessionId: string | null }[] = [];
  const port: StorePort = {
    async unresolvedFor() {
      return [];
    },
    async raise(violations, sessionId) {
      raised.push({ violations: [...violations], sessionId });
    },
    async resolveForFile(path, sessionId) {
      resolved.push({ path, sessionId });
      return 1;
    },
    async outstanding() {
      return [];
    },
    async prune() {
      return 0;
    },
  };
  return { port, raised, resolved };
}

/**
 * A gate result with sensible defaults.
 *
 * @param over - Fields to override.
 */
const result = (over: Partial<GateResult> = {}): GateResult => ({
  gate: 'no-bad',
  passed: false,
  severity: 'critical',
  findings: [],
  stats: { filesChecked: 1, findingsCount: 0, durationMs: 0 },
  ...over,
});

/**
 * A runner returning a report built from the given gate results.
 *
 * @param gates - The per-gate results.
 */
const runnerOf = (gates: GateResult[]): GateRunner => ({
  async runForFiles(): Promise<HealthReport> {
    return {
      timestamp: 't',
      mode: 'changed-only',
      changedFiles: null,
      overall: gates.some((g) => !g.passed) ? 'FAIL' : 'PASS',
      summary: {
        totalGates: gates.length,
        passed: gates.filter((g) => g.passed).length,
        failed: gates.filter((g) => !g.passed).length,
        totalFindings: gates.reduce((n, g) => n + g.findings.length, 0),
        hasCritical: gates.some((g) => !g.passed && g.severity === 'critical'),
      },
      gates,
    };
  },
});

/**
 * A post-tool event over the given edited paths.
 *
 * @param editedPaths - The changed paths.
 * @param sessionId - The owning session.
 */
const event = (
  editedPaths: string[],
  sessionId: string | null = 'sess-1',
): ToolPostEvent => ({
  type: 'tool.post',
  sessionId,
  toolName: 'edit',
  editedPaths,
  failed: false,
});

describe('checkEdit — nothing to gate', () => {
  it('is a no-op when no files were edited', async () => {
    const store = fakeStore();
    const r = await checkEdit(
      { store: store.port, gates: runnerOf([]), isIgnored: () => false },
      event([]),
    );
    expect(r).toEqual({ kind: 'noop' });
    expect(store.resolved).toHaveLength(0);
  });

  it('is a no-op when every edited path is pawignored', async () => {
    const store = fakeStore();
    const r = await checkEdit(
      { store: store.port, gates: runnerOf([]), isIgnored: () => true },
      event(['.paw/config.json']),
    );
    expect(r).toEqual({ kind: 'noop' });
  });
});

describe('checkEdit — clean run', () => {
  it('clears stale violations and stays silent when gates pass', async () => {
    const store = fakeStore();
    const r = await checkEdit(
      { store: store.port, gates: runnerOf([result({ passed: true })]), isIgnored: () => false },
      event(['src/a.ts']),
    );
    expect(r).toEqual({ kind: 'noop' });
    expect(store.resolved).toEqual([{ path: 'src/a.ts', sessionId: 'sess-1' }]);
    expect(store.raised).toHaveLength(0);
  });

  it('ignores a failed non-critical (warning) gate', async () => {
    const store = fakeStore();
    const r = await checkEdit(
      {
        store: store.port,
        gates: runnerOf([
          result({ passed: false, severity: 'warning', findings: [{ file: 'src/a.ts', rule: 'style', message: 'nit' }] }),
        ]),
        isIgnored: () => false,
      },
      event(['src/a.ts']),
    );
    expect(r).toEqual({ kind: 'noop' });
    expect(store.raised).toHaveLength(0);
  });
});

describe('checkEdit — critical run blocks and records', () => {
  it('clears then raises the critical findings and returns block', async () => {
    const store = fakeStore();
    const r = await checkEdit(
      {
        store: store.port,
        gates: runnerOf([
          result({
            findings: [
              { file: 'src/a.ts', line: 3, rule: 'no-bad', message: 'BADCODE present' },
              { file: 'src/a.ts', rule: 'no-bad', message: 'another', indirectFix: true },
            ],
          }),
        ]),
        isIgnored: () => false,
      },
      event(['src/a.ts']),
    );

    expect(r.kind).toBe('block');
    if (r.kind === 'block') {
      expect(r.reason).toContain('2 gate violation(s) across 1 rule type(s)');
      expect(r.reason).toContain('no-bad ×2: BADCODE present (e.g. src/a.ts:3)');
    }
    expect(store.resolved).toEqual([{ path: 'src/a.ts', sessionId: 'sess-1' }]);
    expect(store.raised).toHaveLength(1);
    expect(store.raised[0].violations).toEqual([
      { id: 0, filePath: 'src/a.ts', rule: 'no-bad', message: 'BADCODE present', indirectFix: false },
      { id: 0, filePath: 'src/a.ts', rule: 'no-bad', message: 'another', indirectFix: true },
    ]);
  });

  it('collapses many findings to one line per rule and caps the rest', async () => {
    const store = fakeStore();
    const findings = Array.from({ length: 14 }, (_, i) => ({
      file: `src/f${i}.ts`,
      rule: `rule-${i}`,
      message: 'x'.repeat(200),
    }));
    const r = await checkEdit(
      { store: store.port, gates: runnerOf([result({ findings })]), isIgnored: () => false },
      event(['src/f0.ts']),
    );

    expect(r.kind).toBe('block');
    if (r.kind === 'block') {
      expect(r.reason).toContain('14 gate violation(s) across 14 rule type(s)');
      expect(r.reason).toContain('rule-0: ');
      expect(r.reason).toContain('…');
      expect(r.reason).toContain('…and 2 more rule type(s)');
      expect(r.reason).not.toContain('rule-13');
    }
  });

  it('skips ignored paths but still gates the rest', async () => {
    const store = fakeStore();
    const gated: string[][] = [];
    const gates: GateRunner = {
      async runForFiles(paths) {
        gated.push([...paths]);
        return runnerOf([
          result({ findings: [{ file: 'src/a.ts', rule: 'no-bad', message: 'x' }] }),
        ]).runForFiles(paths);
      },
    };
    const r = await checkEdit(
      { store: store.port, gates, isIgnored: (p) => p.startsWith('dist/') },
      event(['dist/skip.js', 'src/a.ts']),
    );
    expect(gated).toEqual([['src/a.ts']]);
    expect(r.kind).toBe('block');
  });
});
