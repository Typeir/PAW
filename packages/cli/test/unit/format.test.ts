/**
 * PAW CLI Formatter Tests
 *
 * @fileoverview Covers every formatter branch — ready/not-ready doctor with
 * config and role problems, an ok and a refused plan doctor, a member brief, and
 * a released and a refused herd — so `format.ts` reaches 100%.
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
  SwarmPlan,
} from '@paw/core';
import {
  formatBrief,
  formatDoctor,
  formatGateReport,
  formatHerd,
  formatPlanDoctor,
} from '../../src/format.js';

/**
 * Build a health report with defaults, overriding only what a case needs.
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
    expect(out).toContain('  ✓ role memory.draft → (unbound)');
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
