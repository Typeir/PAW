/**
 * PAW Console State
 *
 * @fileoverview The pure heart of the console: the initial state, the reducer
 * that maps an action to the next state, and the selectors every view reads
 * through. React owns none of this — `useReducer` merely drives it — so a
 * transition is a unit test rather than a rendered assertion. Scrubbing a member
 * drops any draft, so the editor always shows the member in view; a `refresh`
 * swaps in a newer snapshot's data while keeping the operator where they were,
 * because a poll that reset the view to Overview every three seconds would make
 * the live console unusable.
 *
 * @module @paw/gui/domain/consoleState
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { DoctorFinding, DoctorReport, MemberView, RoleDoctorRow, RunProgress } from '@paw/core';
import type { ConsoleAction, ConsoleData, ConsoleState } from './console.types.js';
import { toggleContext } from './context.js';
import { briefOf, clampMember } from './plan.js';

/**
 * The starting state: the Swarm subsystem, the Plan tab, first member, no draft.
 *
 * @param {ConsoleData} data - The loaded data.
 * @returns {ConsoleState} The initial state.
 */
export function initialState(data: ConsoleData): ConsoleState {
  return {
    section: 'swarm',
    tab: 'plan',
    member: 0,
    draft: null,
    plan: data.selectedPlan,
    context: [],
    data,
  };
}

/**
 * Advance the state by one action. Pure and total.
 *
 * @param {ConsoleState} state - The current state.
 * @param {ConsoleAction} action - The dispatched action.
 * @returns {ConsoleState} The next state.
 */
export function reduce(state: ConsoleState, action: ConsoleAction): ConsoleState {
  switch (action.type) {
    case 'section':
      return { ...state, section: action.section };
    case 'tab':
      return { ...state, tab: action.tab };
    case 'select':
      return { ...state, member: clampMember(state.data.plan, action.member), draft: null };
    case 'step':
      return {
        ...state,
        member: clampMember(state.data.plan, state.member + action.delta),
        draft: null,
      };
    case 'edit':
      return { ...state, draft: action.text };
    case 'reset':
      return { ...state, draft: null };
    case 'refresh':
      return { ...state, data: action.data, member: clampMember(action.data.plan, state.member) };
    case 'context-toggle':
      return { ...state, context: toggleContext(state.context, action.paths) };
    case 'context-clear':
      return { ...state, context: [] };
    case 'select-plan':
      return { ...state, plan: action.plan, member: 0, draft: null };
  }
}

/**
 * The brief the editor shows: the edited draft when present, else the plan's
 * rendered brief for the scrubbed member.
 *
 * @param {ConsoleState} state - The current state.
 * @returns {string} The effective brief text.
 */
export function effectiveBrief(state: ConsoleState): string {
  return state.draft ?? briefOf(state.data.plan, state.member);
}

/**
 * The herd row for the scrubbed member, if the run dispatched it.
 *
 * @param {ConsoleState} state - The current state.
 * @returns {MemberView | undefined} The row, or undefined when not dispatched.
 */
export function currentMemberView(state: ConsoleState): MemberView | undefined {
  return state.data.run.members.find((m) => m.member === state.member);
}

/**
 * How many members the run actually dispatched — everything that is not a skip.
 *
 * @param {RunProgress} run - The run progress.
 * @returns {number} The dispatched count.
 */
export function dispatchedCount(run: RunProgress): number {
  return run.done + run.running + run.failed;
}

/**
 * Whether a named plan-doctor check is present and passing.
 *
 * @param {readonly DoctorFinding[]} checks - The plan's doctor findings.
 * @param {string} check - The check name.
 * @returns {boolean} True when the check ran and passed.
 */
export function checkOk(checks: readonly DoctorFinding[], check: string): boolean {
  const finding = checks.find((f) => f.check === check);
  return finding !== undefined && finding.ok;
}

/**
 * The doctor row for a role, if it is declared.
 *
 * @param {DoctorReport} doctor - The doctor report.
 * @param {string} role - The role name.
 * @returns {RoleDoctorRow | undefined} The row, or undefined when undeclared.
 */
export function roleRow(doctor: DoctorReport, role: string): RoleDoctorRow | undefined {
  return doctor.roles.find((r) => r.role === role);
}

/**
 * Whether the plan's role is bound to a model that satisfies it.
 *
 * @param {ConsoleData} data - The console data.
 * @returns {boolean} True when the role is declared and not blocking.
 */
export function planRoleOk(data: ConsoleData): boolean {
  const row = roleRow(data.doctor, data.plan.role);
  return row !== undefined && !row.blocking;
}
