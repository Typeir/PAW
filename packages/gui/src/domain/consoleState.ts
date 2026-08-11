/**
 * PAW Console State
 *
 * @fileoverview Console state core. Initial state, reducer map action to
 * next state, and selectors every view read through. State live outside React:
 * `useReducer` merely drive it, so each transition verify with a unit test.
 * Scrub member drop any draft, so editor always show that member in
 * view; a `refresh` swap in a newer snapshot's data while keep operator where
 * them be, because a poll that reset view to Overview every three seconds make
 * live console unusable.
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
 * Start state: Swarm subsystem, Plan tab, first member, no draft.
 *
 * @param {ConsoleData} data - Loaded data.
 * @returns {ConsoleState} Initial state.
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
 * Advance state by one action. Pure and total.
 *
 * @param {ConsoleState} state - Current state.
 * @param {ConsoleAction} action - Dispatched action.
 * @returns {ConsoleState} Next state.
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
 * Brief editor show: edited draft when present, else plan's rendered brief for
 * scrubbed member.
 *
 * @param {ConsoleState} state - Current state.
 * @returns {string} Effective brief text.
 */
export function effectiveBrief(state: ConsoleState): string {
  return state.draft ?? briefOf(state.data.plan, state.member);
}

/**
 * Member row for scrubbed member, if run dispatch it.
 *
 * @param {ConsoleState} state - Current state.
 * @returns {MemberView | undefined} Row, or undefined when not dispatched.
 */
export function currentMemberView(state: ConsoleState): MemberView | undefined {
  return state.data.run.members.find((m) => m.member === state.member);
}

/**
 * How many member run actually dispatch — everything that not a skip.
 *
 * @param {RunProgress} run - Run progress.
 * @returns {number} Dispatched count.
 */
export function dispatchedCount(run: RunProgress): number {
  return run.done + run.running + run.failed;
}

/**
 * Whether a named plan-doctor check present and passing.
 *
 * @param {readonly DoctorFinding[]} checks - Plan's doctor findings.
 * @param {string} check - Check name.
 * @returns {boolean} True when check ran and passed.
 */
export function checkOk(checks: readonly DoctorFinding[], check: string): boolean {
  const finding = checks.find((f) => f.check === check);
  return finding !== undefined && finding.ok;
}

/**
 * Doctor row for a role, if it declared.
 *
 * @param {DoctorReport} doctor - Doctor report.
 * @param {string} role - Role name.
 * @returns {RoleDoctorRow | undefined} Row, or undefined when undeclared.
 */
export function roleRow(doctor: DoctorReport, role: string): RoleDoctorRow | undefined {
  return doctor.roles.find((r) => r.role === role);
}

/**
 * Whether plan's role bound to a model that satisfy it.
 *
 * @param {ConsoleData} data - Console data.
 * @returns {boolean} True when role declared and not blocking.
 */
export function planRoleOk(data: ConsoleData): boolean {
  const row = roleRow(data.doctor, data.plan.role);
  return row !== undefined && !row.blocking;
}
