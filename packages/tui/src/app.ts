/**
 * PAW TUI State
 *
 * @fileoverview The pure heart of the terminal UI: the view state and the
 * reducer. A reducer step takes a message — a keypress or the result of an async
 * action — and returns the next state plus any effects the shell should run. The
 * effects carry no I/O themselves; `main.ts` runs them and feeds their results
 * back as messages. This keeps every transition a snapshot test while letting the
 * TUI drive the same verbs the CLI does (gates first, more to follow).
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
  type HealthReport,
  type SwarmPlan,
} from '@paw/core';

/**
 * The views the TUI cycles between.
 */
export type View = 'doctor' | 'plan' | 'herd' | 'gates';

/**
 * Data loaded once by the shell for the read-only views.
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
 * @property {TuiData} data - The loaded data the read-only views render.
 * @property {HealthReport | null} gates - The last gate run, or null before one.
 * @property {boolean} busy - True while an action is running.
 * @property {boolean} quit - True once the user has asked to exit.
 */
export interface TuiState {
  readonly view: View;
  readonly member: number;
  readonly data: TuiData;
  readonly gates: HealthReport | null;
  readonly busy: boolean;
  readonly quit: boolean;
}

/**
 * A message the reducer folds: a keypress, or the result of an action.
 */
export type Msg =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'gates'; readonly report: HealthReport };

/**
 * An action the shell runs, feeding its result back as a {@link Msg}.
 */
export type Effect = { readonly kind: 'run-gates' };

/**
 * A reducer step: the next state and any effects to run.
 *
 * @interface Step
 * @property {TuiState} state - The next state.
 * @property {Effect[]} effects - Effects the shell should run.
 */
export interface Step {
  readonly state: TuiState;
  readonly effects: readonly Effect[];
}

/**
 * The initial state: the doctor view, first member selected, nothing running.
 *
 * @param {TuiData} data - The loaded data.
 * @returns {TuiState} The starting state.
 */
export function initialState(data: TuiData): TuiState {
  return { view: 'doctor', member: 0, data, gates: null, busy: false, quit: false };
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
 * A step with no effects.
 *
 * @param {TuiState} state - The next state.
 * @returns {Step} The step.
 */
function stay(state: TuiState): Step {
  return { state, effects: [] };
}

/**
 * Fold a keypress into the next step.
 *
 * @param {TuiState} state - The current state.
 * @param {string} key - The pressed key.
 * @returns {Step} The next step.
 */
function onKey(state: TuiState, key: string): Step {
  switch (key) {
    case '1':
      return stay({ ...state, view: 'doctor' });
    case '2':
      return stay({ ...state, view: 'plan' });
    case '3':
      return stay({ ...state, view: 'herd' });
    case 'j':
      return stay({ ...state, member: clampMember(state, state.member + 1) });
    case 'k':
      return stay({ ...state, member: clampMember(state, state.member - 1) });
    case 'g':
      return state.busy
        ? stay(state)
        : { state: { ...state, view: 'gates', busy: true }, effects: [{ kind: 'run-gates' }] };
    case 'q':
      return stay({ ...state, quit: true });
    default:
      return stay(state);
  }
}

/**
 * Advance the state by one message. Pure: an unknown key returns the state
 * unchanged with no effects.
 *
 * @param {TuiState} state - The current state.
 * @param {Msg} msg - The message to fold.
 * @returns {Step} The next state and any effects.
 */
export function reduce(state: TuiState, msg: Msg): Step {
  if (msg.kind === 'gates') {
    return stay({ ...state, gates: msg.report, busy: false, view: 'gates' });
  }
  return onKey(state, msg.key);
}
