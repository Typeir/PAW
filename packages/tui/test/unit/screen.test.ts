/**
 * PAW TUI Renderer Tests
 *
 * @fileoverview Snapshots a full screen for each view and each notable data
 * shape — a ready and an unready doctor, the plan/brief view with fit padding,
 * exact-fit, and truncation, and a released, a refused, and an unreleased herd —
 * so `screen.ts` reaches 100% and every frame is a regression artifact. The
 * snapshots are the regression tier from CONSTRAINTS.md Constraint 1.
 *
 * @module @paw/tui/test/unit/screen
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
  initialState,
  type ConfigSnapshot,
  type DaemonSnapshot,
  type TuiData,
  type TuiState,
} from '../../src/domain/app.js';
import { render } from '../../src/domain/screen.js';

const gateStat = { filesChecked: 1, findingsCount: 0, durationMs: 0 };

const failReport: HealthReport = {
  timestamp: 't',
  mode: 'changed-only',
  changedFiles: null,
  overall: 'FAIL',
  summary: { totalGates: 2, passed: 1, failed: 1, totalFindings: 10, hasCritical: true },
  gates: [
    { gate: 'ok', passed: true, severity: 'warning', findings: [], stats: gateStat },
    {
      gate: 'no-any',
      passed: false,
      severity: 'critical',
      findings: Array.from({ length: 10 }, (_, i) => ({
        file: `src/f${i}.ts`,
        ...(i === 0 ? {} : { line: i + 1 }),
        rule: 'no-any',
        message: 'no any',
      })),
      stats: { ...gateStat, findingsCount: 10 },
    },
  ],
};

const passReport: HealthReport = {
  timestamp: 't',
  mode: 'changed-only',
  changedFiles: null,
  overall: 'PASS',
  summary: { totalGates: 1, passed: 1, failed: 0, totalFindings: 0, hasCritical: false },
  gates: [{ gate: 'ok', passed: true, severity: 'warning', findings: [], stats: gateStat }],
};

/**
 * A plan whose brief has a short line, an exactly-68-char line (the frame's inner
 * width), and an over-long line — so `fit` pads, matches, and truncates.
 */
const plan: SwarmPlan<unknown> = {
  name: 'demo',
  role: 'edit.apply',
  args: {},
  members: 2,
  brief: () => ['short', 'E'.repeat(68), 'L'.repeat(80)].join('\n'),
  key: (_a, m) => ['alpha', 'beta'][m],
};

const readyDoctor: DoctorReport = {
  ok: true,
  config: [],
  roles: [
    { role: 'edit.apply', optional: false, boundTo: 'ds-flash', satisfaction: { ok: true, reasons: [] }, blocking: false },
    { role: 'memory.draft', optional: true, boundTo: null, satisfaction: null, blocking: false },
  ],
};

const brokenDoctor: DoctorReport = {
  ok: false,
  config: [{ field: 'connector', message: 'unknown connector "x"' }],
  roles: [
    { role: 'review.judge', optional: false, boundTo: 'weak', satisfaction: { ok: false, reasons: ['requires reasoning'] }, blocking: true },
  ],
};

const releasedHerd: DispatchResult = {
  released: true,
  findings: [],
  outcomes: [
    { member: 0, key: 'alpha', state: 'done', content: 'x' },
    { member: 1, key: 'beta', state: 'skipped' },
  ],
};

const refusedHerd: DispatchResult = {
  released: false,
  findings: [
    { check: 'count', ok: true },
    { check: 'file-conflict', ok: false, detail: 'two members target x' },
  ],
  outcomes: [],
};

const runningDaemon: DaemonSnapshot = {
  status: { pid: 4242, uptimeMs: 65_000, health: 'ok', projectRoot: '/repo' },
  violations: [],
};

const daemonWithViolations: DaemonSnapshot = {
  status: { pid: 4242, uptimeMs: 5000, health: 'ok', projectRoot: '/repo' },
  violations: [
    { id: 1, filePath: 'src/a.ts', rule: 'no-any', message: 'x', indirectFix: false },
    { id: 2, filePath: 'src/a.ts', rule: 'jsdoc', message: 'y', indirectFix: false },
    { id: 3, filePath: 'src/b.ts', rule: 'no-any', message: 'z', indirectFix: false },
  ],
};

const daemonManyFiles: DaemonSnapshot = {
  status: { pid: 1, uptimeMs: 0, health: 'ok', projectRoot: '/repo' },
  violations: Array.from({ length: 9 }, (_, i) => ({
    id: i,
    filePath: `src/f${i}.ts`,
    rule: 'no-any',
    message: 'm',
    indirectFix: false,
  })),
};

const stoppedDaemon: DaemonSnapshot = { status: null, violations: [] };

const configBindings: ConfigSnapshot = {
  models: ['fast', 'slow'],
  bindings: [
    { role: 'edit.apply', bound: 'fast' },
    { role: 'review.graze', bound: null },
    { role: 'review.judge', bound: 'slow' },
  ],
};

const configNoModels: ConfigSnapshot = {
  models: [],
  bindings: [{ role: 'edit.apply', bound: null }],
};

/**
 * Build a state on a given view with the given data pieces.
 *
 * @param view - The active view.
 * @param over - Data overrides.
 * @param member - Selected member.
 */
function stateOn(
  view: TuiState['view'],
  over: Partial<TuiData>,
  member = 0,
): TuiState {
  const data: TuiData = { doctor: readyDoctor, plan, herd: releasedHerd, ...over };
  return { ...initialState(data), view, member };
}

describe('render', () => {
  it('frames a ready doctor', () => {
    expect(render(stateOn('doctor', {})).lines).toMatchSnapshot();
  });

  it('frames an unready doctor with config and role problems', () => {
    expect(render(stateOn('doctor', { doctor: brokenDoctor })).lines).toMatchSnapshot();
  });

  it('frames the plan view with the selected member brief', () => {
    expect(render(stateOn('plan', {}, 1)).lines).toMatchSnapshot();
  });

  it('frames a released herd', () => {
    expect(render(stateOn('herd', {})).lines).toMatchSnapshot();
  });

  it('frames a refused herd', () => {
    expect(render(stateOn('herd', { herd: refusedHerd })).lines).toMatchSnapshot();
  });

  it('frames an unreleased herd', () => {
    expect(render(stateOn('herd', { herd: null })).lines).toMatchSnapshot();
  });

  it('frames the gates view while a run is in progress', () => {
    expect(render({ ...stateOn('gates', {}), busy: true }).lines).toMatchSnapshot();
  });

  it('frames the gates view before any run', () => {
    expect(render(stateOn('gates', {})).lines).toMatchSnapshot();
  });

  it('frames a failing gate run, capping a busy gate and locating findings', () => {
    expect(render({ ...stateOn('gates', {}), gates: failReport }).lines).toMatchSnapshot();
  });

  it('frames a passing gate run', () => {
    expect(render({ ...stateOn('gates', {}), gates: passReport }).lines).toMatchSnapshot();
  });

  it('frames the daemon view while a query is in progress', () => {
    expect(render({ ...stateOn('daemon', {}), busy: true }).lines).toMatchSnapshot();
  });

  it('frames the daemon view before any query', () => {
    expect(render(stateOn('daemon', {})).lines).toMatchSnapshot();
  });

  it('frames a stopped daemon', () => {
    expect(render({ ...stateOn('daemon', {}), daemon: stoppedDaemon }).lines).toMatchSnapshot();
  });

  it('frames a running daemon holding no violations', () => {
    expect(render({ ...stateOn('daemon', {}), daemon: runningDaemon }).lines).toMatchSnapshot();
  });

  it('frames a running daemon, grouping violations by file', () => {
    expect(render({ ...stateOn('daemon', {}), daemon: daemonWithViolations }).lines).toMatchSnapshot();
  });

  it('frames a running daemon, capping the file list', () => {
    expect(render({ ...stateOn('daemon', {}), daemon: daemonManyFiles }).lines).toMatchSnapshot();
  });

  it('frames the config view while reading', () => {
    expect(render({ ...stateOn('config', {}), busy: true }).lines).toMatchSnapshot();
  });

  it('frames the config view before any read', () => {
    expect(render(stateOn('config', {})).lines).toMatchSnapshot();
  });

  it('frames the config view with bindings and the selected role marked', () => {
    expect(render({ ...stateOn('config', {}), config: configBindings, role: 1 }).lines).toMatchSnapshot();
  });

  it('frames the config view when no models are declared', () => {
    expect(render({ ...stateOn('config', {}), config: configNoModels }).lines).toMatchSnapshot();
  });

  it('truncates an over-long line with an ellipsis and pads a short one', () => {
    const lines = render(stateOn('plan', {}, 1)).lines;
    expect(lines.some((l) => l.includes('…'))).toBe(true);
    expect(lines.every((l) => l.length === 72)).toBe(true);
  });
});
