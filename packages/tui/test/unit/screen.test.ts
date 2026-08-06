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
  SwarmPlan,
} from '@paw/core';
import { initialState, type TuiData, type TuiState } from '../../src/app.js';
import { render } from '../../src/screen.js';

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

  it('truncates an over-long line with an ellipsis and pads a short one', () => {
    const lines = render(stateOn('plan', {}, 1)).lines;
    expect(lines.some((l) => l.includes('…'))).toBe(true);
    expect(lines.every((l) => l.length === 72)).toBe(true);
  });
});
