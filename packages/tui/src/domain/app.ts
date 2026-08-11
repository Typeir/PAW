/**
 * PAW TUI State
 *
 * @fileoverview DOM-free UI state module: view state and reducer. Reducer step
 * take message — keypress or result of async action — and hand back next state plus
 * any effects shell must run. Effect carry no I/O; `main.ts` run them and feed
 * result back as message. Snapshot test every transition while TUI drive same
 * verbs CLI do: gates on working tree, daemon verbs (status, violations, prune,
 * stop) over same socket CLI use.
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
 * Views TUI cycle between.
 */
export type View = 'doctor' | 'plan' | 'herd' | 'gates' | 'daemon' | 'config';

/**
 * Resident daemon self-report, same shape as `daemon.status` return.
 *
 * @interface DaemonStatus
 * @property {number} pid - Daemon process id.
 * @property {number} uptimeMs - Milliseconds since daemon start.
 * @property {string} health - Daemon health word.
 * @property {string} projectRoot - Repository daemon serve.
 */
export interface DaemonStatus {
  readonly pid: number;
  readonly uptimeMs: number;
  readonly health: string;
  readonly projectRoot: string;
}

/**
 * One look at daemon: running or not, plus violations it hold. Null status mean
 * no daemon answer for this repository.
 *
 * @interface DaemonSnapshot
 * @property {DaemonStatus | null} status - Daemon self-report, or null when none run.
 * @property {Violation[]} violations - Violations it hold.
 */
export interface DaemonSnapshot {
  readonly status: DaemonStatus | null;
  readonly violations: readonly Violation[];
}

/**
 * One role and model it bound to, or null when unbound.
 *
 * @interface ConfigBinding
 * @property {string} role - Role id.
 * @property {string | null} bound - Model it bound to, or null.
 */
export interface ConfigBinding {
  readonly role: string;
  readonly bound: string | null;
}

/**
 * Repo model bindings as config view edit them: declared models and every
 * role binding.
 *
 * @interface ConfigSnapshot
 * @property {string[]} models - Declared model ids.
 * @property {ConfigBinding[]} bindings - One entry per role.
 */
export interface ConfigSnapshot {
  readonly models: readonly string[];
  readonly bindings: readonly ConfigBinding[];
}

/**
 * Data shell load once for read-only views.
 *
 * @interface TuiData
 * @property {DoctorReport} doctor - Unified doctor report.
 * @property {SwarmPlan<unknown>} plan - Loaded swarm plan.
 * @property {DispatchResult | null} herd - Dispatch result, or null before release.
 */
export interface TuiData {
  readonly doctor: DoctorReport;
  readonly plan: SwarmPlan<unknown>;
  readonly herd: DispatchResult | null;
}

/**
 * Full UI state.
 *
 * @interface TuiState
 * @property {View} view - Active view.
 * @property {number} member - Selected member index in plan view.
 * @property {TuiData} data - Loaded data read-only views render.
 * @property {HealthReport | null} gates - Last gate run, or null before one.
 * @property {DaemonSnapshot | null} daemon - Last daemon look, or null before one.
 * @property {ConfigSnapshot | null} config - Loaded bindings, or null before config view open.
 * @property {number} role - Selected role index in config view.
 * @property {boolean} busy - True while action run.
 * @property {boolean} quit - True once user ask to exit.
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
 * Message reducer fold: keypress, or result of action.
 */
export type Msg =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'gates'; readonly report: HealthReport }
  | { readonly kind: 'daemon'; readonly snapshot: DaemonSnapshot }
  | { readonly kind: 'config'; readonly snapshot: ConfigSnapshot };

/**
 * Action shell run, feed result back as {@link Msg}. Daemon action all resolve
 * to fresh {@link DaemonSnapshot}: refresh read it, prune clear violations then
 * re-read, stop ask daemon to exit, restart shell out to `paw daemon restart` to
 * bring pawd back (or start it when none run) before re-read.
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
 * Reducer step: next state and any effects to run.
 *
 * @interface Step
 * @property {TuiState} state - Next state.
 * @property {Effect[]} effects - Effects shell should run.
 */
export interface Step {
  readonly state: TuiState;
  readonly effects: readonly Effect[];
}

/**
 * Initial state: doctor view, first member chosen, nothing run.
 *
 * @param {TuiData} data - Loaded data.
 * @returns {TuiState} Starting state.
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
 * Clamp member index to plan valid range.
 *
 * @param {TuiState} state - Current state.
 * @param {number} next - Proposed index.
 * @returns {number} Clamped index.
 */
function clampMember(state: TuiState, next: number): number {
  const last = Math.max(0, memberCount(state.data.plan) - 1);
  return Math.min(last, Math.max(0, next));
}

/**
 * Clamp role index to loaded binding range.
 *
 * @param {TuiState} state - Current state.
 * @param {number} next - Proposed index.
 * @returns {number} Clamped index.
 */
function clampRole(state: TuiState, next: number): number {
  const last = Math.max(0, (state.config?.bindings.length ?? 1) - 1);
  return Math.min(last, Math.max(0, next));
}

/**
 * Next model in cycle for role: unbound → first → … → last → unbound.
 *
 * @param {string | null} current - Role current binding.
 * @param {readonly string[]} models - Declared models.
 * @returns {string | null} Next model, or null to unbind.
 */
function nextBinding(current: string | null, models: readonly string[]): string | null {
  const next = (current === null ? -1 : models.indexOf(current)) + 1;
  return next >= models.length ? null : models[next];
}

/**
 * Effect that cycle selected role binding, or null when nothing load or no
 * model to bind to.
 *
 * @param {TuiState} state - Current state.
 * @returns {Effect | null} Bind or unbind effect, or null.
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
 * Step with no effect.
 *
 * @param {TuiState} state - Next state.
 * @returns {Step} The step.
 */
function stay(state: TuiState): Step {
  return { state, effects: [] };
}

/**
 * Open view and start action that populate it, unless one already run.
 * Shared by gates and daemon verbs.
 *
 * @param {TuiState} state - Current state.
 * @param {View} view - View to open.
 * @param {Effect} effect - Action to run.
 * @returns {Step} Next step.
 */
function open(state: TuiState, view: View, effect: Effect): Step {
  return state.busy
    ? stay(state)
    : { state: { ...state, view, busy: true }, effects: [effect] };
}

/**
 * Run daemon action, but only from daemon view and only when idle — so stray
 * `p` or `s` on other view do nothing.
 *
 * @param {TuiState} state - Current state.
 * @param {Effect} effect - Daemon action to run.
 * @returns {Step} Next step.
 */
function daemonAction(state: TuiState, effect: Effect): Step {
  return state.view === 'daemon' && !state.busy
    ? { state: { ...state, busy: true }, effects: [effect] }
    : stay(state);
}

/**
 * Fold keypress into next step.
 *
 * @param {TuiState} state - Current state.
 * @param {string} key - Pressed key.
 * @returns {Step} Next step.
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
 * Advance state by one message. Pure: unknown key return state unchanged, no
 * effect.
 *
 * @param {TuiState} state - Current state.
 * @param {Msg} msg - Message to fold.
 * @returns {Step} Next state and any effect.
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
