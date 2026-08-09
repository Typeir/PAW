/**
 * PAW TUI Reducer Tests
 *
 * @fileoverview Drives every transition of the pure effect-reducer — the view
 * switches, member selection with both clamps, quit, the unknown-key no-op, and
 * the gates action (start → busy + effect, the busy guard, and folding the
 * result) — so `app.ts` reaches 100%.
 *
 * @module @paw/tui/test/unit/app
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import type { DispatchResult, DoctorReport, HealthReport, SwarmPlan } from '@paw/core';
import { initialState, reduce, type TuiData, type TuiState } from '../../src/app.js';

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

const key = (state: TuiState, k: string) => reduce(state, { kind: 'key', key: k });

describe('initialState', () => {
  it('starts on the doctor view, first member, nothing running', () => {
    expect(initialState(data)).toEqual({
      view: 'doctor',
      member: 0,
      data,
      gates: null,
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
});
