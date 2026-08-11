/**
 * PAW Presentation Contracts
 *
 * @fileoverview Wire contract. Producer be console state (`pawd` daemon, read real host and plan), consumer render it (web UI, Electron shell). Plain JSON-serializable data, no functions; cross HTTP boundary and IPC channel whole. Swarm plan `brief(args, member)` pre-render to `briefs` array here. Types only; coverage gate cut this file, also cut ports and event union. Daemon fill every field from real sources; static demo fill same shape with fixtures.
 *
 * @module @paw/core/contracts
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { DoctorReport } from './application/doctor.js';
import type { MemberOutcome } from './application/dispatchSwarm.js';
import type { InitMode } from './domain/initConfig.js';
import type { DoctorFinding } from './domain/swarm.js';
import type { Violation } from './domain/violation.js';

/**
 * Member display state. Real batch dispatch give `done | skipped`; live daemon stream run add `running | failed`.
 */
export type MemberViewState = MemberOutcome['state'] | 'running' | 'failed';

/**
 * Facts about host process daemon run in; read from `process` and `os`.
 *
 * @interface HostInfo
 * @property {number} pid - Daemon process id.
 * @property {number} ppid - Parent process id.
 * @property {number} uptimeSec - Seconds process alive.
 * @property {number} rssBytes - Resident set size in bytes.
 * @property {string} hostname - Machine hostname.
 * @property {string} platform - `os.platform()` (win32/darwin/linux).
 * @property {string} release - OS release string.
 * @property {number} cpus - Logical CPU count.
 * @property {string} node - Node version run daemon.
 * @property {string} cwd - Daemon working directory.
 */
export interface HostInfo {
  readonly pid: number;
  readonly ppid: number;
  readonly uptimeSec: number;
  readonly rssBytes: number;
  readonly hostname: string;
  readonly platform: string;
  readonly release: string;
  readonly cpus: number;
  readonly node: string;
  readonly cwd: string;
}

/**
 * One process PAW own: daemon itself or swarm worker descended from it.
 * Control API expose only this subtree of host process table.
 *
 * @interface HostProcess
 * @property {number} pid - Process id.
 * @property {number} ppid - Parent process id.
 * @property {string} name - Image/command name.
 */
export interface HostProcess {
  readonly pid: number;
  readonly ppid: number;
  readonly name: string;
}

/**
 * One node of repository file tree, as daemon serve it and selector render it. Paths relative to served root, always use `/`. File have no children.
 *
 * @interface TreeNode
 * @property {string} name - Entry own name, last path segment.
 * @property {string} path - Entry path relative to served root.
 * @property {boolean} isFile - Whether this file, not directory.
 * @property {TreeNode[]} children - Child entries; empty for file.
 */
export interface TreeNode {
  readonly name: string;
  readonly path: string;
  readonly isFile: boolean;
  readonly children: readonly TreeNode[];
}

/**
 * Daemon status pill; derived from {@link HostInfo}.
 *
 * @interface DaemonStatus
 * @property {boolean} live - Whether daemon serving.
 * @property {string} uptimeLabel - Human uptime, e.g. `2h14m`.
 * @property {number} pid - Daemon process id.
 * @property {string} socket - Bound address, e.g. `127.0.0.1:8971`.
 * @property {number} rssMb - Resident set size in megabytes.
 * @property {string} proto - Control protocol version.
 * @property {number} storeWriters - Store writer count.
 */
export interface DaemonStatus {
  readonly live: boolean;
  readonly uptimeLabel: string;
  readonly pid: number;
  readonly socket: string;
  readonly rssMb: number;
  readonly proto: string;
  readonly storeWriters: number;
}

/**
 * Spend meter.
 *
 * @interface BudgetSummary
 * @property {number} spendUsd - Spend so far in US dollars.
 * @property {number} tokensIn - Prompt tokens consumed.
 * @property {number} tokensOut - Completion tokens generated.
 */
export interface BudgetSummary {
  readonly spendUsd: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
}

/**
 * One herd row for Herd tab.
 *
 * @interface MemberView
 * @property {number} member - Zero-based member index.
 * @property {string} key - Member resume key (a slug).
 * @property {MemberViewState} state - Terminal or live state.
 * @property {number | null} level - Per-member level, or null when unknown.
 * @property {string} [note] - Optional short note (e.g. an error reason).
 */
export interface MemberView {
  readonly member: number;
  readonly key: string;
  readonly state: MemberViewState;
  readonly level: number | null;
  readonly note?: string;
}

/**
 * Run identity and progress split.
 *
 * @interface RunProgress
 * @property {string} id - Short run id.
 * @property {string} startedAt - Run start timestamp label.
 * @property {number} skipped - Members skipped by plan `skip` filter.
 * @property {number} done - Members completed.
 * @property {number} running - Members currently running.
 * @property {number} failed - Members failed.
 * @property {number} confirmed - Members whose output confirmed/captured.
 * @property {MemberView[]} members - Dispatched members, for Herd tab.
 */
export interface RunProgress {
  readonly id: string;
  readonly startedAt: string;
  readonly skipped: number;
  readonly done: number;
  readonly running: number;
  readonly failed: number;
  readonly confirmed: number;
  readonly members: readonly MemberView[];
}

/**
 * Rail counts, no backing core report yet.
 *
 * @interface RailChrome
 * @property {number} gates - Gate count.
 * @property {number} keys - Provider key count.
 */
export interface RailChrome {
  readonly gates: number;
  readonly keys: number;
}

/**
 * Full console state. Producer ship it, consumer render it. Every field plain data; swarm plan pre-render to `briefs`/`slugs`.
 *
 * @interface PawSnapshot
 * @property {HostInfo} host - Real host/process facts.
 * @property {HostProcess[]} processes - Real host process list.
 * @property {string} root - Served repository; scope console hold.
 * @property {string} configPath - Where config found, or empty when repo have none.
 * @property {string[]} plans - Every `*.swarm.mjs` in served repository, repo-relative.
 * @property {string | null} selectedPlan - Which of them plan fields below describe; null when none selected.
 * @property {string} planName - Selected plan name; empty when none selected.
 * @property {string} planRole - Role plan model must satisfy.
 * @property {number} memberTotal - Plan member count; 0 when none selected.
 * @property {string} planSource - Plan module source text.
 * @property {number} highlightLine - 1-based editor line to accent.
 * @property {string[]} briefs - Rendered brief per member.
 * @property {string[]} slugs - Resume key per member.
 * @property {DoctorReport} doctor - Unified doctor (config + roles).
 * @property {DoctorFinding[]} planFindings - Swarm plan doctor findings.
 * @property {RunProgress} run - Run identity and progress split.
 * @property {BudgetSummary} budget - Spend meter.
 * @property {Violation[]} violations - Open enforcement violations.
 * @property {DaemonStatus} daemon - Daemon status pill.
 * @property {RailChrome} chrome - Gates/Keys rail counts.
 */
export interface PawSnapshot {
  readonly host: HostInfo;
  readonly processes: readonly HostProcess[];
  readonly root: string;
  readonly configPath: string;
  readonly plans: readonly string[];
  readonly selectedPlan: string | null;
  readonly planName: string;
  readonly planRole: string;
  readonly memberTotal: number;
  readonly planSource: string;
  readonly highlightLine: number;
  readonly briefs: readonly string[];
  readonly slugs: readonly string[];
  readonly doctor: DoctorReport;
  readonly planFindings: readonly DoctorFinding[];
  readonly run: RunProgress;
  readonly budget: BudgetSummary;
  readonly violations: readonly Violation[];
  readonly daemon: DaemonStatus;
  readonly chrome: RailChrome;
}

/**
 * Everything console show about one selected plan, as single value.
 *
 * These fields expensive ones: brief and resume key rendered per member. Grouping them let producer compute once per version of plan file, let live wire send them alone when file change.
 *
 * @interface PlanSlice
 * @property {string | null} selectedPlan - Plan in view, or null when none.
 * @property {string} planName - Its name; empty when none selected.
 * @property {string} planRole - Role its model must satisfy.
 * @property {number} memberTotal - Its member count.
 * @property {string} planSource - Module source text.
 * @property {number} highlightLine - 1-based editor line to accent.
 * @property {string[]} briefs - Rendered brief per member.
 * @property {string[]} slugs - Resume key per member.
 * @property {DoctorFinding[]} planFindings - Plan own doctor findings.
 */
export interface PlanSlice {
  readonly selectedPlan: string | null;
  readonly planName: string;
  readonly planRole: string;
  readonly memberTotal: number;
  readonly planSource: string;
  readonly highlightLine: number;
  readonly briefs: readonly string[];
  readonly slugs: readonly string[];
  readonly planFindings: readonly DoctorFinding[];
}

/**
 * What repository hold, as plan picker need it.
 *
 * @interface PlansSlice
 * @property {string[]} plans - Every `*.swarm.mjs` in repository, repo-relative.
 * @property {string} configPath - Where config found, or empty.
 */
export interface PlansSlice {
  readonly plans: readonly string[];
  readonly configPath: string;
}

/**
 * One line in daemon log ring.
 *
 * @interface LogEntry
 * @property {string} at - When written, ISO-8601.
 * @property {'info' | 'warn' | 'error'} level - Severity.
 * @property {string} message - What happened.
 */
export interface LogEntry {
  readonly at: string;
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
}

/**
 * Recoverable problem daemon surface to console without close connection: unknown plan, plan module that will not load.
 *
 * @interface LiveError
 * @property {string} code - Stable machine-readable code, e.g. `unknown-plan`.
 * @property {string} message - What to tell operator.
 */
export interface LiveError {
  readonly code: string;
  readonly message: string;
}

/**
 * Every slice of console state that change on own, and payload each carry. One map type producer, socket, and consumer reducer from same place.
 *
 * @interface LiveTopicMap
 * @property {PawSnapshot} hello - Whole state, sent after auth and after any resync.
 * @property {HostInfo} host - Host facts; also liveness ticker.
 * @property {HostProcess[]} processes - Owned process subtree.
 * @property {PlansSlice} plans - What repository hold.
 * @property {PlanSlice} planDetail - Watched plan, rendered.
 * @property {DoctorReport} doctor - Config and role doctor.
 * @property {RunProgress} run - Dispatched run progress.
 * @property {BudgetSummary} budget - What run spent.
 * @property {TreeNode[]} tree - Repository tree.
 * @property {LogEntry[]} log - Newly appended log lines.
 * @property {LiveError} error - Recoverable problem.
 */
/**
 * Where attach request stand.
 *
 * `unconfigured` report directory console scoped to hold no PAW config. Rest track request console made: `pending` while operator asked out-of-band, then one of three endings. Socket carry this state; it hold no authority to change it.
 *
 * @interface AttachState
 * @property {'idle' | 'unconfigured' | 'pending' | 'approved' | 'refused' | 'failed'} status - Where request stand.
 * @property {string | null} path - Repository in question, or null when idle.
 * @property {InitMode} [mode] - Resolution requested, once one been had.
 * @property {string} [reason] - Why, for `refused` and `failed`.
 */
export interface AttachState {
  readonly status:
    | 'idle'
    | 'unconfigured'
    | 'pending'
    | 'approved'
    | 'refused'
    | 'failed';
  readonly path: string | null;
  readonly mode?: InitMode;
  readonly reason?: string;
}

export interface LiveTopicMap {
  readonly hello: PawSnapshot;
  readonly attach: AttachState;
  readonly host: HostInfo;
  readonly processes: readonly HostProcess[];
  readonly plans: PlansSlice;
  readonly planDetail: PlanSlice;
  readonly doctor: DoctorReport;
  readonly run: RunProgress;
  readonly budget: BudgetSummary;
  readonly tree: readonly TreeNode[];
  readonly log: readonly LogEntry[];
  readonly error: LiveError;
}

/**
 * Name of one slice.
 */
export type LiveTopic = keyof LiveTopicMap;

/**
 * One server-to-client frame, **decoded**. Every payload be full new value of its slice: no delta, no replay buffer. Consumer resync by request `hello`.
 *
 * Shape is the code-level form. Wire payload is more compact; `domain/liveWire.ts` encodes and decodes between wire and code forms.
 *
 * @interface LiveEnvelope
 * @property {1} v - Protocol version.
 * @property {LiveTopic} topic - Which slice this be.
 * @property {number} at - When daemon sent it, epoch milliseconds.
 * @property {unknown} data - Slice new value, typed by `topic`.
 */
export interface LiveEnvelope<T extends LiveTopic = LiveTopic> {
  readonly v: 1;
  readonly topic: T;
  readonly at: number;
  readonly data: LiveTopicMap[T];
}

/**
 * Messages client may send, decoded. Anything else be protocol violation and close connection.
 *
 * `auth` and `watch` manage subscription. `attach` and `release` each request action; daemon record someone asked. It do no write, spend no money, gain no authority. Operator approve request out-of-band, in terminal that start daemon, and process holding authority do work. `release` keep console-, TUI-, or `paw ui`-triggered live herd non-autonomous; CLI standalone runner be autonomous path.
 */
export type ClientMessage =
  | { readonly v: 1; readonly type: 'auth'; readonly token: string }
  | { readonly v: 1; readonly type: 'watch'; readonly plan: string | null }
  | { readonly v: 1; readonly type: 'scope'; readonly path: string }
  | {
      readonly v: 1;
      readonly type: 'attach';
      readonly path: string;
      readonly mode: InitMode;
    }
  | { readonly v: 1; readonly type: 'release'; readonly settings: RunSettings };

/**
 * Settings console, TUI, or `paw ui` carry when ask daemon to release herd: run capabilities every surface expose identically. Shared shape wire move, daemon act on.
 *
 * @interface RunSettings
 * @property {string} plan - Plan daemon hold to release, by name console watch it under.
 * @property {boolean} live - Whether dispatch against live provider (spends) or deterministic fake.
 * @property {number} [maxOutputTokens] - Per-run output ceiling; omit, take each model default.
 * @property {number} [concurrency] - Members in flight at once; omit, take dispatcher default.
 * @property {readonly string[]} [context] - File globs whose contents attach to every member brief.
 */
export interface RunSettings {
  readonly plan: string;
  readonly live: boolean;
  readonly maxOutputTokens?: number;
  readonly concurrency?: number;
  readonly context?: readonly string[];
}
