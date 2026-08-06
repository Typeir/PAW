/**
 * PAW TUI Reducer Tests
 *
 * @fileoverview Drives every transition of the pure reducer — the three view
 * switches, member selection with both clamps, quit, and the unknown-key
 * no-op — so `app.ts` reaches 100%.
 *
 * @module @paw/tui/test/unit/app
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import type { DispatchResult, DoctorReport, SwarmPlan } from '@paw/core';
import { initialState, reduce, type TuiData } from '../../src/app.js';

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

describe('initialState', () => {
  it('starts on the doctor view with the first member selected', () => {
    expect(initialState(data)).toEqual({ view: 'doctor', member: 0, data, quit: false });
  });
});

describe('reduce', () => {
  it('switches views with 1/2/3', () => {
    const s = initialState(data);
    expect(reduce(s, '1').view).toBe('doctor');
    expect(reduce(s, '2').view).toBe('plan');
    expect(reduce(s, '3').view).toBe('herd');
  });

  it('moves member selection with j, clamped to the last member', () => {
    const s = initialState(data);
    expect(reduce(s, 'j').member).toBe(1);
    expect(reduce(reduce(s, 'j'), 'j').member).toBe(1);
  });

  it('moves member selection with k, clamped to zero', () => {
    expect(reduce(initialState(data), 'k').member).toBe(0);
  });

  it('quits on q', () => {
    expect(reduce(initialState(data), 'q').quit).toBe(true);
  });

  it('ignores an unknown key, returning the same state', () => {
    const s = initialState(data);
    expect(reduce(s, 'z')).toBe(s);
  });
});
