/**
 * PAW TUI Reducer Tests
 *
 * @fileoverview Drives every transition of the pure effect-reducer — the view
 * switches, member selection with both clamps, quit, the unknown-key no-op, the
 * gates action, and the daemon verbs (open + refresh, the busy guard, folding a
 * snapshot, and prune/stop gated to the idle daemon view) — so `app.ts` reaches
 * 100%.
 *
 * @module @paw/tui/test/unit/app
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import type { DispatchResult, DoctorReport, HealthReport, SwarmPlan } from '@paw/core';
import {
  initialState,
  reduce,
  type DaemonSnapshot,
  type TuiData,
  type TuiState,
} from '../../src/domain/app.js';

const plan: SwarmPlan<{ files: string[] }> = {
  name: 'demo',
  role: 'edit.apply',
  args: { files: ['alpha', 'beta'] },
  members: (a) => a.files.length,
  brief: (a, m, n) => `member ${m + 1}/${n}: ${a.files[m]}`,
  key: (a, m) => a.files[m],
};
const doctor: DoctorReport = { ok: true, config: [], roles: [] };
const herd: DispatchResult = { released: true, findings: [], outcomes: [] };
const data: TuiData = { doctor, plan: plan as SwarmPlan<unknown>, herd };

const report: HealthReport = {
  timestamp: 't',
  mode: 'changed-only',
  changedFiles: null,
  overall: 'FAIL',
  summary: { totalGates: 1, passed: 0, failed: 1, totalFindings: 1, hasCritical: true },
  gates: [],
};

const snapshot: DaemonSnapshot = {
  status: { pid: 42, uptimeMs: 5000, health: 'ok', projectRoot: '/repo' },
  violations: [],
};

const key = (state: TuiState, k: string) => reduce(state, { kind: 'key', key: k });

/** The idle daemon view: opened with d, then a snapshot folded to clear busy. */
const idleDaemon = (): TuiState =>
  reduce(key(initialState(data), 'd').state, { kind: 'daemon', snapshot }).state;

describe('initialState', () => {
  it('starts on the doctor view, first member, nothing running', () => {
    expect(initialState(data)).toEqual({
      view: 'doctor',
      member: 0,
      data,
      gates: null,
      daemon: null,
      busy: false,
      quit: false,
    });
  });
});

describe('reduce', () => {
  it('switches views with 1/2/3', () => {
    const s = initialState(data);
    expect(key(s, '1').state.view).toBe('doctor');
    expect(key(s, '2').state.view).toBe('plan');
    expect(key(s, '3').state.view).toBe('herd');
  });

  it('moves member selection with j, clamped to the last member', () => {
    const s = initialState(data);
    expect(key(s, 'j').state.member).toBe(1);
    expect(key(key(s, 'j').state, 'j').state.member).toBe(1);
  });

  it('moves member selection with k, clamped to zero', () => {
    expect(key(initialState(data), 'k').state.member).toBe(0);
  });

  it('quits on q', () => {
    expect(key(initialState(data), 'q').state.quit).toBe(true);
  });

  it('ignores an unknown key, returning the same state and no effects', () => {
    const s = initialState(data);
    const step = key(s, 'z');
    expect(step.state).toBe(s);
    expect(step.effects).toEqual([]);
  });

  it('runs gates on g: busy, gates view, one run-gates effect', () => {
    const step = key(initialState(data), 'g');
    expect(step.state.busy).toBe(true);
    expect(step.state.view).toBe('gates');
    expect(step.effects).toEqual([{ kind: 'run-gates' }]);
  });

  it('does not queue a second gate run while one is busy', () => {
    const busy = key(initialState(data), 'g').state;
    const step = key(busy, 'g');
    expect(step.state).toBe(busy);
    expect(step.effects).toEqual([]);
  });

  it('folds a gates result: clears busy, stores the report, shows gates', () => {
    const busy = key(initialState(data), 'g').state;
    const step = reduce(busy, { kind: 'gates', report });
    expect(step.state.busy).toBe(false);
    expect(step.state.gates).toBe(report);
    expect(step.state.view).toBe('gates');
    expect(step.effects).toEqual([]);
  });

  it('opens the daemon view on d: busy, one daemon-refresh effect', () => {
    const step = key(initialState(data), 'd');
    expect(step.state.busy).toBe(true);
    expect(step.state.view).toBe('daemon');
    expect(step.effects).toEqual([{ kind: 'daemon-refresh' }]);
  });

  it('does not query the daemon again while one query is busy', () => {
    const busy = key(initialState(data), 'd').state;
    const step = key(busy, 'd');
    expect(step.state).toBe(busy);
    expect(step.effects).toEqual([]);
  });

  it('folds a daemon snapshot: clears busy, stores it, shows daemon', () => {
    const busy = key(initialState(data), 'd').state;
    const step = reduce(busy, { kind: 'daemon', snapshot });
    expect(step.state.busy).toBe(false);
    expect(step.state.daemon).toBe(snapshot);
    expect(step.state.view).toBe('daemon');
    expect(step.effects).toEqual([]);
  });

  it('prunes on p from the idle daemon view: busy, one daemon-prune effect', () => {
    const step = key(idleDaemon(), 'p');
    expect(step.state.busy).toBe(true);
    expect(step.effects).toEqual([{ kind: 'daemon-prune' }]);
  });

  it('stops on s from the idle daemon view: busy, one daemon-stop effect', () => {
    const step = key(idleDaemon(), 's');
    expect(step.state.busy).toBe(true);
    expect(step.effects).toEqual([{ kind: 'daemon-stop' }]);
  });

  it('restarts on r from the idle daemon view: busy, one daemon-restart effect', () => {
    const step = key(idleDaemon(), 'r');
    expect(step.state.busy).toBe(true);
    expect(step.effects).toEqual([{ kind: 'daemon-restart' }]);
  });

  it('ignores p outside the daemon view', () => {
    const s = initialState(data);
    const step = key(s, 'p');
    expect(step.state).toBe(s);
    expect(step.effects).toEqual([]);
  });

  it('ignores p while the daemon view is busy', () => {
    const busy = key(initialState(data), 'd').state;
    const step = key(busy, 'p');
    expect(step.state).toBe(busy);
    expect(step.effects).toEqual([]);
  });
});
