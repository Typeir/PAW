/**
 * PAW TUI Menu Tests
 *
 * @fileoverview Cover the menu domain: every entry pairs an action with the
 * CLI command it teaches, and each line builder renders its data — doctor
 * ready and broken, plan roster with the picked member's brief, herd released,
 * refused, and pre-release, gates clean and failing with caps, daemon running,
 * silent, and holding violations, config bindings. `menu.ts` reach 100%.
 *
 * @module @paw/tui/test/unit/menu
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import type { DispatchResult, DoctorReport, HealthReport, SwarmPlan, Violation } from '@paw/core';
import {
  MENU,
  configLines,
  connectorLines,
  daemonLines,
  doctorLines,
  gatesLines,
  herdLines,
  menuFor,
  moduleLines,
  planLines,
  taskLines,
} from '../../src/domain/menu.js';

const PLAN: SwarmPlan<{ files: string[] }> = {
  name: 'demo',
  role: 'edit.apply',
  args: { files: ['a.mdx', 'b.mdx'] },
  members: (a) => a.files.length,
  brief: (a, m) => `Edit ${a.files[m]}.`,
  key: (a, m) => a.files[m],
};

const READY: DoctorReport = {
  ok: true,
  config: [],
  roles: [
    { role: 'edit.apply', boundTo: 'ds', blocking: false, satisfaction: { ok: true, reasons: [] } },
  ],
} as unknown as DoctorReport;

const BROKEN: DoctorReport = {
  ok: false,
  config: [{ field: 'root', message: 'root must be a non-empty string' }],
  roles: [
    {
      role: 'review.judge',
      boundTo: 'small',
      blocking: true,
      satisfaction: { ok: false, reasons: ['max output 8192 < required 16384'] },
    },
    { role: 'memory.draft', boundTo: null, blocking: false, satisfaction: null },
  ],
} as unknown as DoctorReport;

describe('MENU', () => {
  it('teaches a CLI command on every action except quit', () => {
    for (const entry of MENU) {
      if (entry.id === 'quit') {
        expect(entry.cli).toBeNull();
      } else {
        expect(entry.cli).toContain('paw ');
      }
    }
  });

  it('offers every action id once', () => {
    const ids = MENU.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'doctor',
      'plan',
      'herd',
      'gates',
      'daemon',
      'config',
      'connectors',
      'modules',
      'tasks',
      'quit',
    ]);
  });
});

describe('menuFor', () => {
  it('offers tasks only where the repository has a work model', () => {
    expect(menuFor(true).map((entry) => entry.id)).toContain('tasks');
    expect(menuFor(false).map((entry) => entry.id)).not.toContain('tasks');
    expect(menuFor(false)).toHaveLength(MENU.length - 1);
  });
});

describe('connectorLines', () => {
  it('marks each entry and names the module a backend needs', () => {
    const lines = connectorLines([
      { id: 'tsc', kind: 'linter', title: 'TypeScript', description: 'type errors', enabled: true, requires: [] },
      { id: 'taiga', kind: 'backend', title: 'Taiga', description: 'clones projects', enabled: false, requires: ['paw-agile'] },
    ]);
    expect(lines[0]).toBe('1 of 2 enabled');
    expect(lines[2]).toBe('  ✓ tsc (linter) — type errors');
    expect(lines[3]).toBe('  · taiga (backend) — clones projects [needs paw-agile]');
  });
});

describe('moduleLines', () => {
  it('reports enabled state, installed state, and the connectors carried', () => {
    const lines = moduleLines([
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
    expect(lines[0]).toBe('1 of 2 enabled');
    expect(lines[2]).toBe('  ✓ paw-agile — installed');
    expect(lines[4]).toBe('      connectors: taiga, rally');
    expect(lines[5]).toBe('  · paw-billing — not installed');
    expect(lines[7]).toBe('      connectors: none');
  });
});

describe('taskLines', () => {
  const rows = [
    { id: 'a', title: 'Checkout', parents: [], children: ['b'], depth: 0, rollup: 3, orphan: false },
    { id: 'b', title: 'Card form', parents: ['a'], children: [], depth: 1, rollup: 1, orphan: false },
  ];

  it('names the verb that enables the module when it is off', () => {
    const lines = taskLines({ enabled: false, rows: [], refusals: [], loops: [], dangling: [] });
    expect(lines[0]).toBe('the paw-agile module is not enabled');
    expect(lines).toContain('cli: paw modules enable paw-agile');
  });

  it('indents by depth and names each task’s own edges', () => {
    const lines = taskLines({ enabled: true, rows, refusals: [], loops: [], dangling: [] });
    expect(lines[0]).toBe('2 tasks');
    expect(lines[2]).toBe('  a — Checkout  ↑ —  ↓ b  3');
    expect(lines[3]).toBe('    b — Card form  ↑ a  ↓ —  1');
  });

  it('appends the refused edges when there are any', () => {
    const lines = taskLines({ enabled: true, rows, refusals: ['unknown task "ghost"'], loops: [], dangling: [] });
    expect(lines).toContain('refused: 1');
    expect(lines).toContain('  unknown task "ghost"');
  });

  it('lists ring-closing edges apart from refusals', () => {
    const lines = taskLines({ enabled: true, rows, refusals: [], loops: [{ parent: 'b', child: 'a' }], dangling: [] });
    expect(lines).toContain('loops: 1 declared, not walked');
    expect(lines).toContain('  b → a');
  });

  it('lists edges naming an absent task and marks the orphaned row', () => {
    const orphaned = [{ ...rows[0], orphan: true }];
    const lines = taskLines({
      enabled: true,
      rows: orphaned,
      refusals: [],
      loops: [],
      dangling: [{ parent: 'ghost', child: 'a' }],
    });
    expect(lines[2]).toBe('  a (orphan) — Checkout  ↑ —  ↓ b  3');
    expect(lines).toContain('dangling: 1 naming an absent task');
    expect(lines).toContain('  ghost → a');
  });
});

describe('doctorLines', () => {
  it('reports ready with one row per role', () => {
    const lines = doctorLines(READY);
    expect(lines[0]).toBe('PAW is ready.');
    expect(lines).toContain('✓ edit.apply → ds');
  });

  it('reports config problems and unsatisfied bindings with reasons', () => {
    const lines = doctorLines(BROKEN);
    expect(lines[0]).toBe('PAW is NOT ready.');
    expect(lines).toContain('✗ config.root — root must be a non-empty string');
    expect(lines).toContain('✗ review.judge → small (max output 8192 < required 16384)');
    expect(lines).toContain('✓ memory.draft → (unbound)');
  });
});

describe('planLines', () => {
  it('marks the picked member and prints its brief', () => {
    const lines = planLines(PLAN as SwarmPlan<unknown>, 1);
    expect(lines[0]).toBe('plan: demo · role edit.apply · 2 members');
    expect(lines).toContain('  member 0 — a.mdx');
    expect(lines).toContain('▸ member 1 — b.mdx');
    expect(lines).toContain('── brief · member 1 ──');
    expect(lines).toContain('Edit b.mdx.');
  });
});

describe('herdLines', () => {
  it('notes when nothing has been released', () => {
    expect(herdLines(null)).toEqual(['No herd released yet.']);
  });

  it('lists refusal findings when the doctor refused', () => {
    const refused: DispatchResult = {
      released: false,
      findings: [
        { check: 'count', ok: true },
        { check: 'total-brief', ok: false, detail: 'member 0 rendered an empty brief' },
      ],
      outcomes: [],
    };
    const lines = herdLines(refused);
    expect(lines[0]).toBe('Release REFUSED.');
    expect(lines).toContain('✓ count');
    expect(lines).toContain('✗ total-brief — member 0 rendered an empty brief');
  });

  it('counts done and skipped and lists each outcome', () => {
    const released: DispatchResult = {
      released: true,
      findings: [],
      outcomes: [
        { member: 0, key: 'a.mdx', state: 'done', content: 'x' },
        { member: 1, key: 'b.mdx', state: 'skipped' },
      ],
    };
    const lines = herdLines(released);
    expect(lines[0]).toBe('1 done · 1 skipped');
    expect(lines).toContain('✓ member 0 (a.mdx)');
    expect(lines).toContain('· member 1 (b.mdx)');
  });
});

describe('gatesLines', () => {
  const report = (over: Partial<HealthReport>): HealthReport =>
    ({
      overall: 'healthy',
      summary: { passed: 1, totalGates: 1, totalFindings: 0 },
      gates: [{ gate: 'g', severity: 'critical', passed: true, findings: [] }],
      ...over,
    }) as unknown as HealthReport;

  it('celebrates a clean run', () => {
    const lines = gatesLines(report({}));
    expect(lines[0]).toContain('healthy · 1/1 gate(s)');
    expect(lines).toContain('✓ all gates clean');
  });

  it('lists failing gates with findings, capped at eight', () => {
    const findings = Array.from({ length: 10 }, (_v, i) => ({
      file: `f${i}.ts`,
      line: i,
      rule: 'no-x',
      message: 'no',
    }));
    const lines = gatesLines(
      report({
        overall: 'critical',
        summary: { passed: 0, totalGates: 1, totalFindings: 10 },
        gates: [{ gate: 'style', severity: 'critical', passed: false, findings }],
      } as unknown as Partial<HealthReport>),
    );
    expect(lines).toContain('✗ style (critical) — 10');
    expect(lines).toContain('   f0.ts:0  no-x');
    expect(lines).toContain('   …and 2 more');
  });

  it('locates a finding by file alone when it has no line', () => {
    const lines = gatesLines(
      report({
        overall: 'critical',
        summary: { passed: 0, totalGates: 1, totalFindings: 1 },
        gates: [
          {
            gate: 'style',
            severity: 'warning',
            passed: false,
            findings: [{ file: 'f.ts', rule: 'no-x', message: 'no' }],
          },
        ],
      } as unknown as Partial<HealthReport>),
    );
    expect(lines).toContain('   f.ts  no-x');
  });
});

describe('daemonLines', () => {
  const violation = (filePath: string, rule: string): Violation =>
    ({ filePath, rule }) as Violation;

  it('says when no daemon runs', () => {
    expect(daemonLines({ status: null, violations: [] })).toEqual([
      'No daemon is running for this repository.',
    ]);
  });

  it('shows a running daemon with no violations', () => {
    const lines = daemonLines({
      status: { pid: 7, uptimeMs: 65_000, health: 'ok', projectRoot: '/r' },
      violations: [],
    });
    expect(lines[0]).toBe('● running · pid 7 · up 65s · ok');
    expect(lines).toContain('No outstanding violations.');
  });

  it('groups held violations by file, capped at eight files', () => {
    const violations = [
      violation('a.ts', 'no-x'),
      violation('a.ts', 'no-y'),
      ...Array.from({ length: 9 }, (_v, i) => violation(`f${i}.ts`, 'no-x')),
    ];
    const lines = daemonLines({
      status: { pid: 7, uptimeMs: 1000, health: 'ok', projectRoot: '/r' },
      violations,
    });
    expect(lines).toContain('11 outstanding across 10 file(s):');
    expect(lines).toContain('✗ a.ts  (no-x, no-y)');
    expect(lines).toContain('…and 2 more file(s)');
  });
});

describe('configLines', () => {
  it('lists declared models and each binding', () => {
    const lines = configLines({
      models: ['ds', 'reasoner'],
      bindings: [
        { role: 'edit.apply', bound: 'ds' },
        { role: 'memory.draft', bound: null },
      ],
    });
    expect(lines[0]).toBe('models: ds, reasoner');
    expect(lines).toContain('  edit.apply → ds');
    expect(lines).toContain('  memory.draft → (unbound)');
  });

  it('says when no models are declared', () => {
    expect(configLines({ models: [], bindings: [] })[0]).toBe('models: (none declared)');
  });
});
