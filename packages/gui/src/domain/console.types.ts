/**
 * PAW Console Domain Types
 *
 * @fileoverview Console domain types. Rail item pick subsystem, swarm view pick tab,
 * plan consumed by console, whole console render. Console domain types separate from
 * wire contract. `@paw/core` {@link PawSnapshot} serialized over HTTP; app layer maps
 * it here. No component touches transport shape. Plan arrives with briefs and slugs
 * already in arrays.
 *
 * @module @paw/gui/domain/console.types
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type {
  BudgetSummary,
  DaemonStatus,
  DoctorFinding,
  DoctorReport,
  HostInfo,
  HostProcess,
  LogEntry,
  RailChrome,
  RunProgress,
  Violation,
} from '@paw/core';

/**
 * Subsystem in left rail.
 */
export type Section =
  | 'overview'
  | 'violations'
  | 'gates'
  | 'roles'
  | 'keys'
  | 'swarm'
  | 'logs';

/**
 * Tab inside Swarm view.
 */
export type Tab = 'plan' | 'herd' | 'logs';

/**
 * Plan as console render: identity, source, per-member text. Daemon pre-render
 * it. No live closure needed on this side.
 *
 * @interface PlanView
 * @property {string} name - Plan name.
 * @property {string} role - Role plan model must satisfy.
 * @property {number} total - Member count.
 * @property {string} source - Plan module source text.
 * @property {number} highlightLine - Source line to accent, 1-based.
 * @property {string[]} briefs - Rendered brief per member.
 * @property {string[]} slugs - Resume key per member.
 */
export interface PlanView {
  readonly name: string;
  readonly role: string;
  readonly total: number;
  readonly source: string;
  readonly highlightLine: number;
  readonly briefs: readonly string[];
  readonly slugs: readonly string[];
}

/**
 * Everything console render, in console own terms.
 *
 * @interface ConsoleData
 * @property {HostInfo} host - Facts about host daemon run on.
 * @property {HostProcess[]} processes - Host processes PAW runs.
 * @property {string} root - Served repository; current console scope.
 * @property {string} configPath - Where served repo config found; empty when none.
 * @property {string[]} plans - Every plan served repo provides.
 * @property {string | null} selectedPlan - Which plan `plan` describe; null when none.
 * @property {PlanView} plan - Selected plan; empty plan when none.
 * @property {DoctorReport} doctor - Unified doctor (config + roles).
 * @property {DoctorFinding[]} checks - Swarm plan doctor findings.
 * @property {RunProgress} run - Run identity and progress split.
 * @property {BudgetSummary} budget - Spend meter.
 * @property {Violation[]} violations - Open enforcement violations.
 * @property {DaemonStatus} daemon - Daemon status pill.
 * @property {LogEntry[]} logs - Daemon log entries, oldest first, capped at the ring size.
 * @property {RailChrome} chrome - Gates/Keys rail counts.
 */
export interface ConsoleData {
  readonly host: HostInfo;
  readonly processes: readonly HostProcess[];
  readonly root: string;
  readonly configPath: string;
  readonly plans: readonly string[];
  readonly selectedPlan: string | null;
  readonly plan: PlanView;
  readonly doctor: DoctorReport;
  readonly checks: readonly DoctorFinding[];
  readonly run: RunProgress;
  readonly budget: BudgetSummary;
  readonly violations: readonly Violation[];
  readonly logs: readonly LogEntry[];
  readonly daemon: DaemonStatus;
  readonly chrome: RailChrome;
}

/**
 * Full console state.
 *
 * @interface ConsoleState
 * @property {Section} section - Active rail subsystem.
 * @property {Tab} tab - Active tab inside Swarm view.
 * @property {number} member - Scrubbed member index.
 * @property {string | null} draft - Editor edited brief, or null when show rendered brief.
 * @property {string | null} plan - Plan operator pick; next poll ask daemon for it.
 * @property {string[]} context - Repo files pick to attach to every member brief.
 * @property {ConsoleData} data - Loaded data.
 */
export interface ConsoleState {
  readonly section: Section;
  readonly tab: Tab;
  readonly member: number;
  readonly draft: string | null;
  readonly plan: string | null;
  readonly context: readonly string[];
  readonly data: ConsoleData;
}

/**
 * Action user — or live snapshot from daemon — can take.
 *
 * @typedef {object} ConsoleAction
 */
export type ConsoleAction =
  | { readonly type: 'section'; readonly section: Section }
  | { readonly type: 'tab'; readonly tab: Tab }
  | { readonly type: 'select'; readonly member: number }
  | { readonly type: 'step'; readonly delta: number }
  | { readonly type: 'edit'; readonly text: string }
  | { readonly type: 'reset' }
  | { readonly type: 'refresh'; readonly data: ConsoleData }
  | { readonly type: 'context-toggle'; readonly paths: readonly string[] }
  | { readonly type: 'context-clear' }
  | { readonly type: 'select-plan'; readonly plan: string | null };
