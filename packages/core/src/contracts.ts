/**
 * PAW Presentation Contracts
 *
 * @fileoverview The wire contract between a producer of console state (the `pawd`
 * daemon, which reads the real host and the real plan) and a consumer that renders
 * it (the web UI, the Electron shell). It is deliberately plain, JSON-serializable
 * data: no functions, so it survives an HTTP boundary and an IPC channel intact —
 * a swarm plan's `brief(args, member)` is pre-rendered to a `briefs` array here,
 * not shipped as a closure. Types only, so the coverage gate excludes this file
 * exactly as it excludes the ports and the event union. The daemon fills every
 * field from real sources; a static demo may fill the same shape with fixtures.
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
 * A member's display state. Real batch dispatch yields `done | skipped`; a live
 * daemon streaming a run adds `running | failed`.
 */
export type MemberViewState = MemberOutcome['state'] | 'running' | 'failed';

/**
 * Real facts about the host process the daemon runs in — read from `process` and
 * `os`, the literal "process data from the host machine".
 *
 * @interface HostInfo
 * @property {number} pid - The daemon process id.
 * @property {number} ppid - The parent process id.
 * @property {number} uptimeSec - Seconds the process has been alive.
 * @property {number} rssBytes - Resident set size in bytes.
 * @property {string} hostname - The machine hostname.
 * @property {string} platform - `os.platform()` (win32/darwin/linux).
 * @property {string} release - OS release string.
 * @property {number} cpus - Logical CPU count.
 * @property {string} node - Node version running the daemon.
 * @property {string} cwd - The daemon's working directory.
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
 * One process PAW owns — the daemon itself or a swarm worker descended from it.
 * The control API exposes only this subtree, never the whole host process table,
 * so unrelated software on the machine is not disclosed to a local reader.
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
 * One node of a repository file tree, as the daemon serves it and a selector
 * renders it. Paths are relative to the served root and always use `/`, so the
 * same tree reads identically on every platform; a file has no children.
 *
 * @interface TreeNode
 * @property {string} name - The entry's own name, the last path segment.
 * @property {string} path - The entry's path relative to the served root.
 * @property {boolean} isFile - Whether this is a file rather than a directory.
 * @property {TreeNode[]} children - Child entries; empty for a file.
 */
export interface TreeNode {
  readonly name: string;
  readonly path: string;
  readonly isFile: boolean;
  readonly children: readonly TreeNode[];
}

/**
 * The daemon status pill — derived from {@link HostInfo}, not invented.
 *
 * @interface DaemonStatus
 * @property {boolean} live - Whether the daemon is serving.
 * @property {string} uptimeLabel - Human uptime, e.g. `2h14m`.
 * @property {number} pid - The daemon process id.
 * @property {string} socket - The bound address, e.g. `127.0.0.1:8971`.
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
 * The spend meter.
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
 * One herd row for the Herd tab.
 *
 * @interface MemberView
 * @property {number} member - Zero-based member index.
 * @property {string} key - The member's resume key (a slug).
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
 * Run identity and the progress split.
 *
 * @interface RunProgress
 * @property {string} id - Short run id.
 * @property {string} startedAt - Run start timestamp label.
 * @property {number} skipped - Members skipped by the plan's `skip` filter.
 * @property {number} done - Members completed.
 * @property {number} running - Members currently running.
 * @property {number} failed - Members failed.
 * @property {number} confirmed - Members whose output was confirmed/captured.
 * @property {MemberView[]} members - The dispatched members, for the Herd tab.
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
 * Rail counts with no backing core report yet.
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
 * The full console state as a producer ships it and a consumer renders it. Every
 * field here is plain data; the swarm plan is pre-rendered to `briefs`/`slugs` so
 * nothing needs a live function across the boundary.
 *
 * @interface PawSnapshot
 * @property {HostInfo} host - Real host/process facts.
 * @property {HostProcess[]} processes - Real host process list.
 * @property {string} configPath - Where the config was found, or empty when the repo has none.
 * @property {string[]} plans - Every `*.swarm.mjs` in the served repository, repo-relative.
 * @property {string | null} selectedPlan - Which of them the plan fields below describe; null when none is selected.
 * @property {string} planName - The selected plan's name; empty when none is selected.
 * @property {string} planRole - The role the plan's model must satisfy.
 * @property {number} memberTotal - The plan's member count; 0 when none is selected.
 * @property {string} planSource - The plan module's source text.
 * @property {number} highlightLine - 1-based editor line to accent.
 * @property {string[]} briefs - The rendered brief per member.
 * @property {string[]} slugs - The resume key per member.
 * @property {DoctorReport} doctor - The unified doctor (config + roles).
 * @property {DoctorFinding[]} planFindings - The swarm plan's doctor findings.
 * @property {RunProgress} run - Run identity and progress split.
 * @property {BudgetSummary} budget - The spend meter.
 * @property {Violation[]} violations - Open enforcement violations.
 * @property {DaemonStatus} daemon - The daemon status pill.
 * @property {RailChrome} chrome - Gates/Keys rail counts.
 */
export interface PawSnapshot {
  readonly host: HostInfo;
  readonly processes: readonly HostProcess[];
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
 * Everything the console shows about one selected plan, as a single value.
 *
 * The snapshot carries these fields flat, which is right for a consumer, and
 * wrong for a producer: they are the expensive ones — a brief and a resume key
 * are rendered per member, and a 400-member plan re-rendered on every poll is
 * the whole cost of the console. Grouping them is what lets a producer compute
 * them once per version of the plan file and lets the live wire send them alone
 * when that file changes.
 *
 * @interface PlanSlice
 * @property {string | null} selectedPlan - The plan in view, or null when none is.
 * @property {string} planName - Its name; empty when none is selected.
 * @property {string} planRole - The role its model must satisfy.
 * @property {number} memberTotal - Its member count.
 * @property {string} planSource - The module's source text.
 * @property {number} highlightLine - 1-based editor line to accent.
 * @property {string[]} briefs - The rendered brief per member.
 * @property {string[]} slugs - The resume key per member.
 * @property {DoctorFinding[]} planFindings - The plan's own doctor findings.
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
 * What the repository holds, as the plan picker needs it.
 *
 * @interface PlansSlice
 * @property {string[]} plans - Every `*.swarm.mjs` in the repository, repo-relative.
 * @property {string} configPath - Where the config was found, or empty.
 */
export interface PlansSlice {
  readonly plans: readonly string[];
  readonly configPath: string;
}

/**
 * One line in the daemon's log ring.
 *
 * @interface LogEntry
 * @property {string} at - When it was written, ISO-8601.
 * @property {'info' | 'warn' | 'error'} level - How loud it is.
 * @property {string} message - What happened.
 */
export interface LogEntry {
  readonly at: string;
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
}

/**
 * A recoverable problem the daemon wants the console to show without closing the
 * connection over it — an unknown plan, a plan module that will not load.
 *
 * @interface LiveError
 * @property {string} code - A stable machine-readable code, e.g. `unknown-plan`.
 * @property {string} message - What to tell the operator.
 */
export interface LiveError {
  readonly code: string;
  readonly message: string;
}

/**
 * Every slice of console state that can change on its own, and the payload each
 * one carries. One map so a producer, the socket, and a consumer's reducer are
 * all typed from the same place and cannot drift apart.
 *
 * @interface LiveTopicMap
 * @property {PawSnapshot} hello - The whole state, sent after auth and after any resync.
 * @property {HostInfo} host - Host facts; also the liveness ticker.
 * @property {HostProcess[]} processes - The owned process subtree.
 * @property {PlansSlice} plans - What the repository holds.
 * @property {PlanSlice} planDetail - The watched plan, rendered.
 * @property {DoctorReport} doctor - The config and role doctor.
 * @property {RunProgress} run - A dispatched run's progress.
 * @property {BudgetSummary} budget - What that run has spent.
 * @property {TreeNode[]} tree - The repository tree.
 * @property {LogEntry[]} log - Newly appended log lines.
 * @property {LiveError} error - A recoverable problem.
 */
/**
 * Where an attach request has got to.
 *
 * `unconfigured` is the daemon reporting that a directory the console scoped to
 * holds no PAW config — a fact, not a request. The rest track a request the
 * console made: `pending` while an operator is being asked out-of-band, then one
 * of the three endings. The socket carries this so a console is never left
 * guessing, and carries no authority to change it.
 *
 * @interface AttachState
 * @property {'idle' | 'unconfigured' | 'pending' | 'approved' | 'refused' | 'failed'} status - Where the request stands.
 * @property {string | null} path - The repository in question, or null when idle.
 * @property {InitMode} [mode] - The resolution requested, once one has been.
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
 * The name of one slice.
 */
export type LiveTopic = keyof LiveTopicMap;

/**
 * One server-to-client frame, **decoded**. Every payload is the full new value
 * of its slice: there is no delta and no replay buffer, so a consumer that
 * applies an envelope cannot end up holding a partially-updated slice, and any
 * doubt is answered by asking for `hello` again.
 *
 * This is the shape the code reads. What crosses the wire is smaller — see
 * `domain/liveWire.ts`, which is the only place the two forms meet.
 *
 * @interface LiveEnvelope
 * @property {1} v - The protocol version.
 * @property {LiveTopic} topic - Which slice this is.
 * @property {number} at - When the daemon sent it, epoch milliseconds.
 * @property {unknown} data - The slice's new value, typed by `topic`.
 */
export interface LiveEnvelope<T extends LiveTopic = LiveTopic> {
  readonly v: 1;
  readonly topic: T;
  readonly at: number;
  readonly data: LiveTopicMap[T];
}

/**
 * The only three things a client may say, decoded. Anything else is a protocol
 * violation and closes the connection — a control socket does not negotiate.
 *
 * `auth` and `watch` manage a subscription. `attach` is different in kind and
 * deliberately narrow: it *requests* that PAW be attached to a repository, and
 * the daemon's whole part in it is to remember that someone asked. It performs
 * no write and gains no filesystem authority — an operator approves the request
 * out-of-band, in the terminal that started the daemon, and the process that
 * already had that authority does the work. Kill the daemon mid-flow and nothing
 * has happened, which is the property a POST route would have cost.
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
    };
