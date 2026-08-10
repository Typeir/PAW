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
export type View = 'doctor' | 'plan' | 'herd' | 'gates' | 'daemon' | 'config';

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
 * One role and the model it is bound to, or null when unbound.
 *
 * @interface ConfigBinding
 * @property {string} role - The role id.
 * @property {string | null} bound - The model it is bound to, or null.
 */
export interface ConfigBinding {
  readonly role: string;
  readonly bound: string | null;
}

/**
 * The repo's model bindings as the config view edits them: the declared models
 * and every role's binding.
 *
 * @interface ConfigSnapshot
 * @property {string[]} models - The declared model ids.
 * @property {ConfigBinding[]} bindings - One entry per role.
 */
export interface ConfigSnapshot {
  readonly models: readonly string[];
  readonly bindings: readonly ConfigBinding[];
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
 * @property {ConfigSnapshot | null} config - The loaded bindings, or null before the config view is opened.
 * @property {number} role - The selected role index in the config view.
 * @property {boolean} busy - True while an action is running.
 * @property {boolean} quit - True once the user has asked to exit.
 */
export interface TuiState {
  readonly view: View;
  readonly member: number;
  readonly data: TuiData;
  readonly gates: HealthReport | null;
  readonly daemon: DaemonSnapshot | null;
  readonly config: ConfigSnapshot | null;
  readonly role: number;
  readonly busy: boolean;
  readonly quit: boolean;
}

/**
 * A message the reducer folds: a keypress, or the result of an action.
 */
export type Msg =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'gates'; readonly report: HealthReport }
  | { readonly kind: 'daemon'; readonly snapshot: DaemonSnapshot }
  | { readonly kind: 'config'; readonly snapshot: ConfigSnapshot };

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
  | { readonly kind: 'daemon-restart' }
  | { readonly kind: 'config-refresh' }
  | { readonly kind: 'config-bind'; readonly role: string; readonly model: string }
  | { readonly kind: 'config-unbind'; readonly role: string };

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
    config: null,
    role: 0,
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
 * Clamp a role index to the loaded bindings' range.
 *
 * @param {TuiState} state - The current state.
 * @param {number} next - The proposed index.
 * @returns {number} The clamped index.
 */
function clampRole(state: TuiState, next: number): number {
  const last = Math.max(0, (state.config?.bindings.length ?? 1) - 1);
  return Math.min(last, Math.max(0, next));
}

/**
 * The next model in the cycle for a role: unbound → first → … → last → unbound.
 *
 * @param {string | null} current - The role's current binding.
 * @param {readonly string[]} models - The declared models.
 * @returns {string | null} The next model, or null to unbind.
 */
function nextBinding(current: string | null, models: readonly string[]): string | null {
  const next = (current === null ? -1 : models.indexOf(current)) + 1;
  return next >= models.length ? null : models[next];
}

/**
 * The effect that cycles the selected role's binding, or null when there is
 * nothing loaded or no model to bind to.
 *
 * @param {TuiState} state - The current state.
 * @returns {Effect | null} The bind or unbind effect, or null.
 */
function bindEffect(state: TuiState): Effect | null {
  if (state.config === null || state.config.models.length === 0) {
    return null;
  }
  const current = state.config.bindings[state.role];
  const model = nextBinding(current.bound, state.config.models);
  return model === null
    ? { kind: 'config-unbind', role: current.role }
    : { kind: 'config-bind', role: current.role, model };
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
      return state.view === 'config'
        ? stay({ ...state, role: clampRole(state, state.role + 1) })
        : stay({ ...state, member: clampMember(state, state.member + 1) });
    case 'k':
      return state.view === 'config'
        ? stay({ ...state, role: clampRole(state, state.role - 1) })
        : stay({ ...state, member: clampMember(state, state.member - 1) });
    case 'g':
      return open(state, 'gates', { kind: 'run-gates' });
    case 'd':
      return open(state, 'daemon', { kind: 'daemon-refresh' });
    case 'c':
      return open(state, 'config', { kind: 'config-refresh' });
    case 'p':
      return daemonAction(state, { kind: 'daemon-prune' });
    case 's':
      return daemonAction(state, { kind: 'daemon-stop' });
    case 'r':
      return daemonAction(state, { kind: 'daemon-restart' });
    case 'b': {
      if (state.view !== 'config' || state.busy) {
        return stay(state);
      }
      const effect = bindEffect(state);
      return effect === null ? stay(state) : { state: { ...state, busy: true }, effects: [effect] };
    }
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
  if (msg.kind === 'config') {
    const role = Math.min(state.role, Math.max(0, msg.snapshot.bindings.length - 1));
    return stay({ ...state, config: msg.snapshot, role, busy: false, view: 'config' });
  }
  return onKey(state, msg.key);
}
