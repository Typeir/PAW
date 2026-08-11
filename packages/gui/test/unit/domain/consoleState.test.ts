/**
 * Console State Tests
 *
 * @fileoverview Test every reducer transition and every selector view. State is pure, so the tests run without React.
 *
 * @module @paw/gui/test/unit/domain/consoleState
 */

import { describe, expect, it } from 'vitest';
import { hydrate } from '../../../src/application/hydrateSnapshot.js';
import type { ConsoleState } from '../../../src/domain/console.types.js';
import {
  checkOk,
  currentMemberView,
  dispatchedCount,
  effectiveBrief,
  initialState,
  planRoleOk,
  reduce,
  roleRow,
} from '../../../src/domain/consoleState.js';
import { makeSnapshot } from '../../fixtures.js';

const data = hydrate(makeSnapshot());
const base: ConsoleState = initialState(data);

describe('initialState', () => {
  it('opens on the Swarm plan with the first member and no draft', () => {
    expect(base).toMatchObject({ section: 'swarm', tab: 'plan', member: 0, draft: null });
  });
});

describe('reduce', () => {
  it('selects a section', () => {
    expect(reduce(base, { type: 'section', section: 'roles' }).section).toBe('roles');
  });

  it('selects a tab', () => {
    expect(reduce(base, { type: 'tab', tab: 'herd' }).tab).toBe('herd');
  });

  it('selects a member and drops the draft', () => {
    const edited = reduce(base, { type: 'edit', text: 'mine' });
    const next = reduce(edited, { type: 'select', member: 2 });
    expect(next).toMatchObject({ member: 2, draft: null });
  });

  it('clamps a selected member to the plan', () => {
    expect(reduce(base, { type: 'select', member: 99 }).member).toBe(3);
  });

  it('steps forward and back, clamping at both ends', () => {
    const forward = reduce(base, { type: 'step', delta: 1 });
    expect(forward.member).toBe(1);
    expect(reduce(base, { type: 'step', delta: -1 }).member).toBe(0);
  });

  it('holds an edited draft', () => {
    expect(reduce(base, { type: 'edit', text: 'mine' }).draft).toBe('mine');
  });

  it('resets the draft', () => {
    const edited = reduce(base, { type: 'edit', text: 'mine' });
    expect(reduce(edited, { type: 'reset' }).draft).toBeNull();
  });

  it('refreshes data and keeps the operator on the same member', () => {
    const scrubbed = reduce(base, { type: 'select', member: 3 });
    const next = reduce(scrubbed, { type: 'refresh', data });
    expect(next.member).toBe(3);
    expect(next.data).toBe(data);
  });

  it('clamps the member when a refresh shrinks the plan', () => {
    const scrubbed = reduce(base, { type: 'select', member: 3 });
    const smaller = hydrate(
      makeSnapshot({ memberTotal: 1, briefs: ['only'], slugs: ['only'] }),
    );
    expect(reduce(scrubbed, { type: 'refresh', data: smaller }).member).toBe(0);
  });
});

describe('selectors', () => {
  it('shows the rendered brief until a draft exists', () => {
    expect(effectiveBrief(base)).toBe(data.plan.briefs[0]);
    expect(effectiveBrief(reduce(base, { type: 'edit', text: 'mine' }))).toBe('mine');
  });

  it('finds the herd row for the scrubbed member', () => {
    expect(currentMemberView(base)?.key).toBe('alpha');
  });

  it('has no herd row when the run did not dispatch the member', () => {
    const empty = initialState(hydrate(makeSnapshot({ run: { ...makeSnapshot().run, members: [] } })));
    expect(currentMemberView(empty)).toBeUndefined();
  });

  it('counts everything that is not a skip as dispatched', () => {
    expect(dispatchedCount(data.run)).toBe(3);
  });

  it('reads a plan-doctor check', () => {
    expect(checkOk(data.checks, 'count')).toBe(true);
    expect(checkOk(data.checks, 'total-brief')).toBe(false);
    expect(checkOk(data.checks, 'nonexistent')).toBe(false);
  });

  it('finds a declared role and reports an undeclared one', () => {
    expect(roleRow(data.doctor, 'memory.draft')?.optional).toBe(true);
    expect(roleRow(data.doctor, 'nope')).toBeUndefined();
  });

  it("passes the plan's role when it is bound and satisfied", () => {
    expect(planRoleOk(data)).toBe(true);
  });

  it("fails the plan's role when its binding is blocking", () => {
    const blocked = hydrate(makeSnapshot({ planRole: 'review.judge' }));
    expect(planRoleOk(blocked)).toBe(false);
  });

  it("fails the plan's role when it is not declared at all", () => {
    const missing = hydrate(makeSnapshot({ planRole: 'ghost' }));
    expect(planRoleOk(missing)).toBe(false);
  });
});
