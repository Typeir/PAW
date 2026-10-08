/**
 * PAW CLI formatter tests.
 *
 * @fileoverview Cover every formatter branch: ready and not-ready doctor with
 * config and role problems, role rows, ok and refused plan doctor, member
 * brief, released and refused herd, and the target proof that separates a herd
 * that ran from one that produced. `format.ts` reach 100%.
 *
 * @module @paw/cli/test/unit/format
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import type {
  DispatchResult,
  DoctorReport,
  HealthReport,
  MemberProof,
  SwarmPlan,
} from '@paw/core';
import {
  formatBrief,
  formatConnectors,
  formatModules,
  formatDoctor,
  formatGateReport,
  formatHelp,
  formatHerd,
  formatPlanDoctor,
  formatProof,
  formatPruned,
  formatRoleRows,
  formatTaskDetail,
  formatTasks,
  formatViolations,
} from '../../src/domain/format.js';

describe('formatHelp', () => {
  it('lists every routed command with a usage line', () => {
    const lines = formatHelp();
    expect(lines[0]).toContain('paw');
    expect(lines).toContain('usage: paw <command> [args]');
    for (const verb of [
      'check',
      'hook',
      'daemon',
      'gates',
      'init',
      'sync',
      'violations',
      'config',
      'connectors',
      'doctor',
      'swarm',
      'ui',
      'tui',
      'trust',
    ]) {
      expect(lines.some((line) => line.trimStart().startsWith(verb))).toBe(true);
    }
  });

  it('is plain by default, so pipes and logs carry no escape codes', () => {
    expect(formatHelp().join('\n')).not.toContain('\x1b[');
  });

  it('paints verbs bold, flags grey, params sage, optionals amber, events cyan', () => {
    const painted = formatHelp(true).join('\n');
    expect(painted).toContain('  \x1b[1mcheck\x1b[0m');
    expect(painted).toContain('\x1b[38;5;245m--copilot\x1b[0m');
    expect(painted).toContain('\x1b[3;38;5;108m<event>\x1b[0m');
    expect(painted).toContain('\x1b[3;38;5;179m[--dry-run]\x1b[0m');
    expect(painted).toContain('\x1b[1;38;5;73mtool.pre\x1b[0m');
    expect(painted).toContain('\x1b[1mpaw\x1b[0m — agent enforcement');
  });

  it('paints PAW concepts cyan and tech terms magenta, longest path first', () => {
    const painted = formatHelp(true).join('\n');
    expect(painted).toContain('\x1b[38;5;73mpawd\x1b[0m');
    expect(painted).toContain('\x1b[38;5;73m.paw/\x1b[0m');
    expect(painted).toContain('\x1b[38;5;73m.paw/config.json\x1b[0m');
    expect(painted).toContain('\x1b[38;5;73m.swarm.mjs\x1b[0m');
    expect(painted).toContain('\x1b[38;5;175mTLS\x1b[0m');
    expect(painted).toContain('\x1b[38;5;175mJSON\x1b[0m');
    // The config.json path never splits into a .paw/ prefix + bare json.
    expect(painted).not.toContain('.paw/\x1b[0mconfig');
  });
});

describe('formatConnectors', () => {
  it('counts what is enabled and marks every row', () => {
    const lines = formatConnectors([
      { id: 'tsc', kind: 'linter', title: 'TypeScript', description: 'type errors', enabled: true, requires: [] },
      { id: 'eslint', kind: 'linter', title: 'ESLint', description: 'lint findings', enabled: false, requires: [] },
    ]);
    expect(lines[0]).toBe('connectors: 1 of 2 enabled');
    expect(lines[1]).toBe('  on  tsc · linter · type errors');
    expect(lines[2]).toBe('  off eslint · linter · lint findings');
  });

  it('names the module a backend connector needs', () => {
    const lines = formatConnectors([
      { id: 'taiga', kind: 'backend', title: 'Taiga', description: 'clones projects', enabled: false, requires: ['paw-agile'] },
    ]);
    expect(lines[1]).toBe('  off taiga · backend · clones projects · needs paw-agile');
  });
});

describe('formatTasks', () => {
  const rows = [
    { id: 'a', title: 'Checkout', parents: [], children: ['b'], depth: 0, rollup: 3, orphan: false },
    { id: 'b', title: 'Card form', parents: ['a'], children: [], depth: 1, rollup: 1, orphan: false },
  ];

  it('indents by depth and names each task’s own parents and children', () => {
    expect(formatTasks(rows, [])).toEqual([
      'tasks: 2 in the graph',
      '  a  Checkout  ↑ —  ↓ b  3',
      '    b  Card form  ↑ a  ↓ —  1',
    ]);
  });

  it('appends the refused edges when there are any', () => {
    const lines = formatTasks(rows, ['unknown task "ghost"']);
    expect(lines[3]).toBe('refused: 1');
    expect(lines[4]).toBe('  unknown task "ghost"');
  });

  it('lists ring-closing edges apart from refusals', () => {
    const lines = formatTasks(rows, [], [{ parent: 'b', child: 'a' }]);
    expect(lines[3]).toBe('loops: 1 declared, not walked');
    expect(lines[4]).toBe('  b → a');
    expect(lines).not.toContain('refused: 0');
  });

  it('lists edges naming an absent task and marks the orphaned row', () => {
    const orphaned = [{ ...rows[0], orphan: true }];
    const lines = formatTasks(orphaned, [], [], [{ parent: 'ghost', child: 'a' }]);
    expect(lines[1]).toBe('  a (orphan)  Checkout  ↑ —  ↓ b  3');
    expect(lines[2]).toBe('dangling: 1 naming an absent task');
    expect(lines[3]).toBe('  ghost → a');
  });
});

describe('formatTaskDetail', () => {
  const detail = {
    row: { id: 'd', title: 'Validator', parents: ['b', 'c'], children: ['f'], depth: 2, rollup: 2, orphan: false },
    ancestors: [
      { id: 'b', title: 'Card form', parents: ['a'], children: ['d'], depth: 1, rollup: 3, orphan: false },
    ],
    descendants: [
      { id: 'f', title: 'E2E test', parents: ['d'], children: [], depth: 3, rollup: 1, orphan: true },
    ],
    loops: [{ parent: 'f', child: 'd' }],
    dangling: [{ parent: 'ghost', child: 'f' }],
  };

  it('renders one task without its related tasks by default, unwalked edges included', () => {
    expect(formatTaskDetail(detail, false)).toEqual([
      'task "d" — Validator',
      '  depth 2 · rollup 2',
      '  parents   b, c',
      '  children  f',
      '  loops     f → d',
      '  dangling  ghost → f',
    ]);
  });

  it('adds the ancestor and descendant blocks under --related', () => {
    const lines = formatTaskDetail(detail, true);
    expect(lines).toContain('ancestors: 1');
    expect(lines).toContain('  b  Card form');
    expect(lines).toContain('descendants: 1');
    expect(lines).toContain('  f  E2E test');
  });

  it('renders an em dash for a task with no edges either way', () => {
    const lone = {
      row: { id: 'x', title: 'Lone', parents: [], children: [], depth: 0, rollup: 0, orphan: false },
      ancestors: [],
      descendants: [],
      loops: [],
      dangling: [],
    };
    const lines = formatTaskDetail(lone, true);
    expect(lines[2]).toBe('  parents   —');
    expect(lines[3]).toBe('  children  —');
    expect(lines[4]).toBe('  loops     —');
    expect(lines[5]).toBe('  dangling  —');
    expect(lines).toContain('ancestors: 0');
  });

  it('marks an orphaned task in its heading', () => {
    const orphaned = {
      row: { id: 'x', title: 'Lone', parents: [], children: [], depth: 0, rollup: 0, orphan: true },
      ancestors: [],
      descendants: [],
      loops: [],
      dangling: [{ parent: 'ghost', child: 'x' }],
    };
    expect(formatTaskDetail(orphaned, false)[0]).toBe('task "x" — Lone (orphan)');
  });
});

describe('formatModules', () => {
  it('reports enabled state, whether the package resolves, and the connectors carried', () => {
    const lines = formatModules([
      {
        id: 'paw-agile',
        title: 'PAW Agile',
        description: 'work model',
        specifier: '@paw/agile',
        repository: 'https://example.invalid/paw-agile.git',
        ref: 'main',
        enabled: true,
        resolved: true,
        detail: '/node_modules/@paw/agile',
        requiredBy: ['taiga', 'rally'],
      },
      {
        id: 'paw-billing',
        title: 'PAW Billing',
        description: 'invoices',
        specifier: '@paw/billing',
        repository: 'https://example.invalid/paw-billing.git',
        ref: 'main',
        enabled: false,
        resolved: false,
        detail: 'not installed',
        requiredBy: [],
      },
    ]);
    expect(lines).toEqual([
      'modules: 1 of 2 enabled',
      '  on  paw-agile · installed · work model',
      '      connectors: taiga, rally',
      '  off paw-billing · not installed · invoices',
      '      connectors: none',
    ]);
  });

  it('reports an empty catalogue without a row', () => {
    expect(formatConnectors([])).toEqual(['connectors: 0 of 0 enabled']);
  });
});

describe('formatViolations', () => {
  it('reports no daemon on a null result', () => {
    expect(formatViolations(null)).toEqual(['violations: no daemon is running for this repository']);
  });

  it('reports an empty backlog', () => {
    expect(formatViolations({ violations: [] })).toEqual(['violations: none outstanding']);
  });

  it('treats a missing violations field as empty', () => {
    expect(formatViolations({})).toEqual(['violations: none outstanding']);
  });

  it('groups outstanding violations by file', () => {
    expect(
      formatViolations({
        violations: [
          { id: 1, filePath: 'src/a.ts', rule: 'no-any', message: 'no any', indirectFix: false },
          { id: 2, filePath: 'src/a.ts', rule: 'no-console', message: 'no log', indirectFix: false },
          { id: 3, filePath: 'src/b.ts', rule: 'jsdoc', message: 'missing', indirectFix: false },
        ],
      }),
    ).toEqual([
      'violations: 3 outstanding across 2 file(s)',
      '  src/a.ts',
      '    no-any: no any',
      '    no-console: no log',
      '  src/b.ts',
      '    jsdoc: missing',
    ]);
  });

  it('caps a large backlog across many files and summarises the overflow', () => {
    const violations = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      filePath: `src/f${i}.ts`,
      rule: 'r',
      message: 'm',
      indirectFix: false,
    }));
    const out = formatViolations({ violations });
    expect(out[0]).toBe('violations: 50 outstanding across 50 file(s)');
    expect(out).toContain('  …and 10 more');
  });

  it('caps within a single busy file', () => {
    const violations = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      filePath: 'src/a.ts',
      rule: 'r',
      message: `m${i}`,
      indirectFix: false,
    }));
    const out = formatViolations({ violations });
    expect(out[0]).toBe('violations: 50 outstanding across 1 file(s)');
    expect(out.filter((l) => l.startsWith('    r: ')).length).toBe(40);
    expect(out).toContain('  …and 10 more');
  });
});

describe('formatPruned', () => {
  it('reports no daemon on a null result', () => {
    expect(formatPruned(null, null)).toEqual(['prune: no daemon is running for this repository']);
  });

  it('reports an all-files prune', () => {
    expect(formatPruned({ cleared: 3 }, null)).toEqual(['pruned 3 violation(s) — all files']);
  });

  it('treats a missing cleared field as zero', () => {
    expect(formatPruned({}, null)).toEqual(['pruned 0 violation(s) — all files']);
  });

  it('reports a single-file prune', () => {
    expect(formatPruned({ cleared: 1 }, 'src/a.ts')).toEqual(['pruned 1 violation(s) — src/a.ts']);
  });
});

/**
 * Build health report with defaults. `over` override named fields.
 *
 * @param {Partial<HealthReport>} over - Fields to override.
 * @returns {HealthReport} The report.
 */
const gateReport = (over: Partial<HealthReport> = {}): HealthReport => ({
  timestamp: 't',
  mode: 'full',
  changedFiles: null,
  overall: 'PASS',
  summary: { totalGates: 0, passed: 0, failed: 0, totalFindings: 0, hasCritical: false },
  gates: [],
  ...over,
});

describe('formatGateReport', () => {
  it('renders a clean run', () => {
    const report = gateReport({
      overall: 'PASS',
      summary: { totalGates: 2, passed: 2, failed: 0, totalFindings: 0, hasCritical: false },
      gates: [
        { gate: 'a', passed: true, severity: 'critical', findings: [], stats: { filesChecked: 1, findingsCount: 0, durationMs: 0 } },
        { gate: 'b', passed: true, severity: 'warning', findings: [], stats: { filesChecked: 1, findingsCount: 0, durationMs: 0 } },
      ],
    });
    expect(formatGateReport(report)).toEqual([
      'gates: PASS · 2/2 gate(s) · 0 finding(s)',
      '  ✓ all gates clean',
    ]);
  });

  it('lists each failing gate with located and unlocated findings', () => {
    const report = gateReport({
      overall: 'FAIL',
      summary: { totalGates: 2, passed: 1, failed: 1, totalFindings: 2, hasCritical: true },
      gates: [
        { gate: 'ok', passed: true, severity: 'warning', findings: [], stats: { filesChecked: 1, findingsCount: 0, durationMs: 0 } },
        {
          gate: 'no-bad',
          passed: false,
          severity: 'critical',
          findings: [
            { file: 'src/a.ts', line: 3, rule: 'no-bad', message: 'bad' },
            { file: 'src/b.ts', rule: 'no-bad', message: 'worse' },
          ],
          stats: { filesChecked: 2, findingsCount: 2, durationMs: 0 },
        },
      ],
    });
    expect(formatGateReport(report)).toEqual([
      'gates: FAIL · 1/2 gate(s) · 2 finding(s)',
      '  ✗ no-bad (critical) — 2 finding(s)',
      '      src/a.ts:3  no-bad: bad',
      '      src/b.ts  no-bad: worse',
    ]);
  });

  it('caps findings and summarises the overflow', () => {
    const findings = Array.from({ length: 30 }, (_, i) => ({
      file: `src/f${i}.ts`,
      line: 1,
      rule: 'r',
      message: 'm',
    }));
    const report = gateReport({
      overall: 'FAIL',
      summary: { totalGates: 1, passed: 0, failed: 1, totalFindings: 30, hasCritical: true },
      gates: [{ gate: 'g', passed: false, severity: 'critical', findings, stats: { filesChecked: 30, findingsCount: 30, durationMs: 0 } }],
    });
    const out = formatGateReport(report);
    expect(out[0]).toBe('gates: FAIL · 0/1 gate(s) · 30 finding(s)');
    expect(out).toContain('      …and 5 more');
    expect(out.filter((l) => l.startsWith('      src/'))).toHaveLength(25);
  });
});

describe('formatDoctor', () => {
  it('renders a ready install', () => {
    const report: DoctorReport = {
      ok: true,
      config: [],
      roles: [
        { role: 'edit.apply', optional: false, boundTo: 'ds-flash', satisfaction: { ok: true, reasons: [] }, blocking: false },
      ],
    };
    expect(formatDoctor(report)).toEqual([
      'doctor: ready',
      '  ✓ role edit.apply → ds-flash',
    ]);
  });

  it('renders config problems and a blocking, unsatisfied role', () => {
    const report: DoctorReport = {
      ok: false,
      config: [{ field: 'connector', message: 'unknown connector "x"' }],
      roles: [
        { role: 'review.judge', optional: false, boundTo: 'weak', satisfaction: { ok: false, reasons: ['requires tool calls'] }, blocking: true },
        { role: 'memory.draft', optional: true, boundTo: null, satisfaction: null, blocking: false },
      ],
    };
    const out = formatDoctor(report);
    expect(out[0]).toBe('doctor: NOT READY');
    expect(out).toContain('  ✗ config.connector: unknown connector "x"');
    expect(out).toContain('  ✗ role review.judge → weak — requires tool calls');
    expect(out).toContain('  ✓ role memory.draft → (unbound) [optional]');
  });
});

describe('formatPlanDoctor', () => {
  it('renders an ok plan', () => {
    expect(formatPlanDoctor('p', [{ check: 'count', ok: true }])).toEqual([
      'plan p: ok',
      '  ✓ count',
    ]);
  });

  it('renders a refused plan with detail', () => {
    const out = formatPlanDoctor('p', [
      { check: 'count', ok: true },
      { check: 'file-conflict', ok: false, detail: 'two members target x' },
    ]);
    expect(out[0]).toBe('plan p: REFUSED');
    expect(out).toContain('  ✗ file-conflict — two members target x');
  });
});

const plan: SwarmPlan<{ n: number }> = {
  name: 'demo',
  role: 'edit.apply',
  args: { n: 1 },
  members: 1,
  brief: () => 'line one\nline two',
};

describe('formatBrief', () => {
  it('renders the header and each brief line', () => {
    expect(formatBrief(plan, 0)).toEqual([
      '── demo · member 0 ──',
      'line one',
      'line two',
    ]);
  });
});

describe('formatHerd', () => {
  it('renders a released herd with done and skipped members', () => {
    const result: DispatchResult = {
      released: true,
      findings: [],
      outcomes: [
        { member: 0, key: 'k0', state: 'done', content: 'x' },
        { member: 1, key: 'k1', state: 'skipped' },
      ],
    };
    expect(formatHerd(result)).toEqual([
      'herd: 1 done · 1 skipped',
      '  ✓ member 0 (k0)',
      '  · member 1 (k1)',
    ]);
  });

  it('falls back to the plan doctor when release was refused', () => {
    const result: DispatchResult = {
      released: false,
      findings: [{ check: 'count', ok: false, detail: 'member count is 0' }],
      outcomes: [],
    };
    expect(formatHerd(result)[0]).toBe('plan (release refused): REFUSED');
  });
});

describe('formatRoleRows', () => {
  it('marks an optional role so an unbound one reads as deliberate', () => {
    expect(
      formatRoleRows([
        {
          role: 'memory.draft',
          optional: true,
          boundTo: null,
          satisfaction: null,
          blocking: false,
        },
      ]),
    ).toEqual(['  ✓ role memory.draft → (unbound) [optional]']);
  });

  it('names every reason a required binding falls short', () => {
    expect(
      formatRoleRows([
        {
          role: 'review.judge',
          optional: false,
          boundTo: 'deepseek-chat',
          satisfaction: { ok: false, reasons: ['max output 8192 < required 16384'] },
          blocking: true,
        },
      ]),
    ).toEqual(['  ✗ role review.judge → deepseek-chat — max output 8192 < required 16384']);
  });
});

describe('formatProof', () => {
  const proof = (over: Partial<MemberProof>): MemberProof => ({
    member: 0,
    key: 'k0',
    state: 'proved',
    targets: [],
    ...over,
  });

  it('says targets are not enforced when no member that ran declared one', () => {
    expect(formatProof([proof({ state: 'undeclared' }), proof({ state: 'skipped' })])).toEqual([
      'targets: not enforced — no member that ran declares expectFiles',
    ]);
  });

  it('counts proved and unproved members', () => {
    const out = formatProof([
      proof({ state: 'proved', targets: [{ path: 'a.md', state: 'written' }] }),
      proof({ member: 1, key: 'k1', state: 'skipped' }),
    ]);
    expect(out[0]).toBe('targets: 1 proved · 0 unproved');
    expect(out).toHaveLength(1);
  });

  it('names the empty placeholder a member never filled', () => {
    const out = formatProof([
      proof({
        member: 3,
        key: 'heirlooms-and-attunement',
        state: 'unproved',
        targets: [
          { path: 'findings/heirlooms.md', state: 'empty' },
          { path: 'findings/notes.md', state: 'written' },
        ],
      }),
    ]);
    expect(out).toEqual([
      'targets: 0 proved · 1 unproved',
      '  ✗ member 3 (heirlooms-and-attunement) — declared file is empty: findings/heirlooms.md',
    ]);
  });

  it('names a declared file the member left byte-identical', () => {
    const out = formatProof([
      proof({
        state: 'unproved',
        targets: [{ path: 'src/a.ts', state: 'unchanged' }],
      }),
    ]);
    expect(out[1]).toBe('  ✗ member 0 (k0) — declared file is unchanged: src/a.ts');
  });
});
