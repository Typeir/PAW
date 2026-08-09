/**
 * PAW TUI State
 *
 * @fileoverview The pure heart of the terminal UI: the view state and the
 * reducer. A reducer step takes a message — a keypress or the result of an async
 * action — and returns the next state plus any effects the shell should run. The
 * effects carry no I/O themselves; `main.ts` runs them and feeds their results
 * back as messages. This keeps every transition a snapshot test while letting the
 * TUI drive the same verbs the CLI does: gates on the working tree, and the
 * daemon verbs (status, violations, prune, stop) over the same socket the CLI
 * uses.
 *
 * @module @paw/tui/domain/app
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
  type Violation,
} from '@paw/core';

/**
 * The views the TUI cycles between.
 */
export type View = 'doctor' | 'plan' | 'herd' | 'gates' | 'daemon';

/**
 * The resident daemon's self-report, as returned by `daemon.status`.
 *
 * @interface DaemonStatus
 * @property {number} pid - The daemon's process id.
 * @property {number} uptimeMs - Milliseconds since the daemon started.
 * @property {string} health - The daemon's health word.
 * @property {string} projectRoot - The repository the daemon serves.
 */
export interface DaemonStatus {
  readonly pid: number;
  readonly uptimeMs: number;
  readonly health: string;
  readonly projectRoot: string;
}

/**
 * One look at the daemon: whether it is running, and the violations it holds. A
 * null status means no daemon answered for this repository.
 *
 * @interface DaemonSnapshot
 * @property {DaemonStatus | null} status - The daemon's self-report, or null when none is running.
 * @property {Violation[]} violations - The outstanding violations it is holding.
 */
export interface DaemonSnapshot {
  readonly status: DaemonStatus | null;
  readonly violations: readonly Violation[];
}

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
 * @property {DaemonSnapshot | null} daemon - The last daemon look, or null before one.
 * @property {boolean} busy - True while an action is running.
 * @property {boolean} quit - True once the user has asked to exit.
 */
export interface TuiState {
  readonly view: View;
  readonly member: number;
  readonly data: TuiData;
  readonly gates: HealthReport | null;
  readonly daemon: DaemonSnapshot | null;
  readonly busy: boolean;
  readonly quit: boolean;
}

/**
 * A message the reducer folds: a keypress, or the result of an action.
 */
export type Msg =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'gates'; readonly report: HealthReport }
  | { readonly kind: 'daemon'; readonly snapshot: DaemonSnapshot };

/**
 * An action the shell runs, feeding its result back as a {@link Msg}. The daemon
 * actions all resolve to a fresh {@link DaemonSnapshot}: refresh reads it, prune
 * clears violations then re-reads, stop asks the daemon to exit, and restart
 * shells out to `paw daemon restart` to bring pawd back (or start it when none is
 * running) before re-reading.
 */
export type Effect =
  | { readonly kind: 'run-gates' }
  | { readonly kind: 'daemon-refresh' }
  | { readonly kind: 'daemon-prune' }
  | { readonly kind: 'daemon-stop' }
  | { readonly kind: 'daemon-restart' };

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
  return {
    view: 'doctor',
    member: 0,
    data,
    gates: null,
    daemon: null,
    busy: false,
    quit: false,
  };
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
 * Open a view and start the action that populates it, unless one is already
 * running. Shared by the gates and daemon verbs.
 *
 * @param {TuiState} state - The current state.
 * @param {View} view - The view to open.
 * @param {Effect} effect - The action to run.
 * @returns {Step} The next step.
 */
function open(state: TuiState, view: View, effect: Effect): Step {
  return state.busy
    ? stay(state)
    : { state: { ...state, view, busy: true }, effects: [effect] };
}

/**
 * Run a daemon action, but only from the daemon view and only when idle — so a
 * stray `p` or `s` on another view does nothing.
 *
 * @param {TuiState} state - The current state.
 * @param {Effect} effect - The daemon action to run.
 * @returns {Step} The next step.
 */
function daemonAction(state: TuiState, effect: Effect): Step {
  return state.view === 'daemon' && !state.busy
    ? { state: { ...state, busy: true }, effects: [effect] }
    : stay(state);
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
      return open(state, 'gates', { kind: 'run-gates' });
    case 'd':
      return open(state, 'daemon', { kind: 'daemon-refresh' });
    case 'p':
      return daemonAction(state, { kind: 'daemon-prune' });
    case 's':
      return daemonAction(state, { kind: 'daemon-stop' });
    case 'r':
      return daemonAction(state, { kind: 'daemon-restart' });
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
  if (msg.kind === 'daemon') {
    return stay({ ...state, daemon: msg.snapshot, busy: false, view: 'daemon' });
  }
  return onKey(state, msg.key);
}
