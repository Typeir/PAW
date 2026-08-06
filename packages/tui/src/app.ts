/**
 * PAW TUI State
 *
 * @fileoverview The pure heart of the terminal UI: the view state and the
 * reducer that maps a keypress to the next state. No I/O — the process shell in
 * `main.ts` owns stdin and the screen; this decides what a key means. Kept pure
 * so every transition is a snapshot test, per CONSTRAINTS.md Constraint 1. The
 * data (doctor report, plan, herd result) is loaded by the shell and handed in;
 * the reducer only navigates, so it never needs to await a model.
 *
 * @module @paw/tui/app
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  memberCount,
  type DispatchResult,
  type DoctorReport,
  type SwarmPlan,
} from '@paw/core';

/**
 * The three views the TUI cycles between.
 */
export type View = 'doctor' | 'plan' | 'herd';

/**
 * Everything the views render, loaded once by the shell.
 *
 * @interface TuiData
 * @property {DoctorReport} doctor - The unified doctor report.
 * @property {SwarmPlan<unknown>} plan - The loaded swarm plan.
 * @property {DispatchResult | null} herd - The dispatch result, or null before a release.
 */
export interface TuiData {
  readonly doctor: DoctorReport;
  readonly plan: SwarmPlan<unknown>;
  readonly herd: DispatchResult | null;
}

/**
 * The full UI state.
 *
 * @interface TuiState
 * @property {View} view - The active view.
 * @property {number} member - The selected member index in the plan view.
 * @property {TuiData} data - The loaded data the views render.
 * @property {boolean} quit - True once the user has asked to exit.
 */
export interface TuiState {
  readonly view: View;
  readonly member: number;
  readonly data: TuiData;
  readonly quit: boolean;
}

/**
 * The initial state: the doctor view, first member selected.
 *
 * @param {TuiData} data - The loaded data.
 * @returns {TuiState} The starting state.
 */
export function initialState(data: TuiData): TuiState {
  return { view: 'doctor', member: 0, data, quit: false };
}

/**
 * Clamp a member index to the plan's valid range.
 *
 * @param {TuiState} state - The current state.
 * @param {number} next - The proposed index.
 * @returns {number} The clamped index.
 */
function clampMember(state: TuiState, next: number): number {
  const last = Math.max(0, memberCount(state.data.plan) - 1);
  return Math.min(last, Math.max(0, next));
}

/**
 * Advance the state by one keypress. Pure: unknown keys return the state
 * unchanged.
 *
 * @param {TuiState} state - The current state.
 * @param {string} key - The pressed key (a single character).
 * @returns {TuiState} The next state.
 */
export function reduce(state: TuiState, key: string): TuiState {
  switch (key) {
    case '1':
      return { ...state, view: 'doctor' };
    case '2':
      return { ...state, view: 'plan' };
    case '3':
      return { ...state, view: 'herd' };
    case 'j':
      return { ...state, member: clampMember(state, state.member + 1) };
    case 'k':
      return { ...state, member: clampMember(state, state.member - 1) };
    case 'q':
      return { ...state, quit: true };
    default:
      return state;
  }
}
