/**
 * PAW Console Domain Types
 *
 * @fileoverview The console's own vocabulary: the subsystem a rail item selects,
 * the tab a swarm view shows, the plan as the console needs it, and the whole of
 * what a console renders. These are the module's domain types, not the wire
 * contract — `@paw/core`'s {@link PawSnapshot} crosses the HTTP boundary and the
 * application layer maps it here once, so no component ever touches a transport
 * shape. A plan arrives with its briefs and slugs already rendered to arrays,
 * which is what makes the whole view a pure function of plain data.
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
  RailChrome,
  RunProgress,
  Violation,
} from '@paw/core';

/**
 * A subsystem in the left rail.
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
 * A tab within the Swarm view.
 */
export type Tab = 'plan' | 'herd' | 'logs';

/**
 * The plan as the console renders it: identity, source, and the per-member text
 * the daemon pre-rendered so nothing needs a live closure on this side.
 *
 * @interface PlanView
 * @property {string} name - The plan's name.
 * @property {string} role - The role the plan's model must satisfy.
 * @property {number} total - The member count.
 * @property {string} source - The plan module's source text.
 * @property {number} highlightLine - 1-based source line to accent.
 * @property {string[]} briefs - The rendered brief per member.
 * @property {string[]} slugs - The resume key per member.
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
 * Everything a console renders, in the console's own terms.
 *
 * @interface ConsoleData
 * @property {HostInfo} host - Real facts about the host the daemon runs on.
 * @property {HostProcess[]} processes - The processes PAW owns.
 * @property {string} configPath - Where the served repository's config was found; empty when it has none.
 * @property {string[]} plans - Every plan the served repository holds.
 * @property {string | null} selectedPlan - Which of them `plan` describes; null when none is selected.
 * @property {PlanView} plan - The selected plan; an empty plan when none is selected.
 * @property {DoctorReport} doctor - The unified doctor (config + roles).
 * @property {DoctorFinding[]} checks - The swarm plan's doctor findings.
 * @property {RunProgress} run - Run identity and progress split.
 * @property {BudgetSummary} budget - The spend meter.
 * @property {Violation[]} violations - Open enforcement violations.
 * @property {DaemonStatus} daemon - The daemon status pill.
 * @property {RailChrome} chrome - Gates/Keys rail counts.
 */
export interface ConsoleData {
  readonly host: HostInfo;
  readonly processes: readonly HostProcess[];
  readonly configPath: string;
  readonly plans: readonly string[];
  readonly selectedPlan: string | null;
  readonly plan: PlanView;
  readonly doctor: DoctorReport;
  readonly checks: readonly DoctorFinding[];
  readonly run: RunProgress;
  readonly budget: BudgetSummary;
  readonly violations: readonly Violation[];
  readonly daemon: DaemonStatus;
  readonly chrome: RailChrome;
}

/**
 * The full console state.
 *
 * @interface ConsoleState
 * @property {Section} section - The active rail subsystem.
 * @property {Tab} tab - The active tab within the Swarm view.
 * @property {number} member - The scrubbed member index.
 * @property {string | null} draft - The editor's edited brief, or null when it shows the rendered brief.
 * @property {string | null} plan - The plan the operator picked; what the next poll asks the daemon for.
 * @property {string[]} context - Repository files selected to be attached to every member's brief.
 * @property {ConsoleData} data - The loaded data.
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
 * An action a user — or a live snapshot arriving from the daemon — can take.
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
