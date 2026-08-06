/**
 * PAW Daemon Snapshot Builder
 *
 * @fileoverview Assembles a {@link PawSnapshot} from real inputs: the host facts,
 * the live host process list, and a swarm plan and config loaded from disk. It
 * runs the real `@paw/core` use-cases — `runDoctor` over the actual config and
 * role registry, `doctorPlan`, and `renderBrief`/`planKey` for every member — and
 * pre-renders the briefs and slugs to plain arrays so the plan crosses the HTTP
 * boundary as data, not as a closure. Pure over its injected inputs, so the whole
 * builder is unit-tested; `main.ts` gathers the real inputs and calls it. No field
 * is invented: a run that has not happened reports zeros and an empty herd, which
 * is the truth, rather than a plausible fiction.
 *
 * @module @paw/daemon/snapshot
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  doctorPlan,
  memberCount,
  planKey,
  renderBrief,
  runDoctor,
  type BudgetSummary,
  type HostInfo,
  type HostProcess,
  type PawSnapshot,
  type RoleRegistry,
  type RunProgress,
  type SwarmPlan,
  type Violation,
} from '@paw/core';

/**
 * Everything the snapshot builder needs, all injected so it stays pure.
 *
 * @interface SnapshotInputs
 * @property {HostInfo} host - Real host facts.
 * @property {HostProcess[]} processes - Real host process list.
 * @property {unknown} config - The parsed config object to validate.
 * @property {string} configPath - Where the config came from; empty when the repo has none.
 * @property {string[]} plans - Every plan the repository holds.
 * @property {string | null} selectedPlan - Which plan is in view, or null.
 * @property {SwarmPlan<unknown> | null} plan - The selected plan, loaded from disk; null when none is selected.
 * @property {string} planSource - The plan module's source text; empty when none is selected.
 * @property {RoleRegistry} registry - The role registry built from the config.
 * @property {readonly string[]} knownConnectors - Connector names PAW can resolve.
 * @property {string} socket - The bound address, e.g. `127.0.0.1:8971`.
 * @property {readonly Violation[]} violations - Open enforcement violations (empty when none).
 * @property {number} gates - Gate count for the rail.
 * @property {number} keys - Provider key count for the rail.
 * @property {string} runId - Identifier for the current (not yet dispatched) run.
 * @property {string} startedAt - Timestamp label for the run.
 * @property {RunProgress} [run] - A dispatched run's real progress; omit before a release.
 * @property {BudgetSummary} [budget] - A dispatched run's real token usage; omit before a release.
 */
export interface SnapshotInputs {
  readonly host: HostInfo;
  readonly processes: readonly HostProcess[];
  readonly config: unknown;
  readonly configPath: string;
  readonly plans: readonly string[];
  readonly selectedPlan: string | null;
  readonly plan: SwarmPlan<unknown> | null;
  readonly planSource: string;
  readonly registry: RoleRegistry;
  readonly knownConnectors: readonly string[];
  readonly socket: string;
  readonly violations: readonly Violation[];
  readonly gates: number;
  readonly keys: number;
  readonly runId: string;
  readonly startedAt: string;
  readonly run?: RunProgress;
  readonly budget?: BudgetSummary;
}

/**
 * Format an uptime in seconds as a compact human label.
 *
 * @param {number} sec - Seconds of uptime.
 * @returns {string} A label like `2h14m`, `14m03s`, or `07s`.
 */
export function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}h${String(m).padStart(2, '0')}m`;
  }
  if (m > 0) {
    return `${m}m${String(s).padStart(2, '0')}s`;
  }
  return `${String(s).padStart(2, '0')}s`;
}

/**
 * Build a snapshot from real inputs.
 *
 * @param {SnapshotInputs} input - The gathered inputs.
 * @returns {PawSnapshot} The plain, serializable console state.
 */
export function buildSnapshot(input: SnapshotInputs): PawSnapshot {
  const plan = input.plan;
  const total = plan === null ? 0 : memberCount(plan);
  const doctor = runDoctor(input.config, input.registry, input.knownConnectors);

  return {
    host: input.host,
    processes: input.processes,
    configPath: input.configPath,
    plans: input.plans,
    selectedPlan: input.selectedPlan,
    planName: plan === null ? '' : plan.name,
    planRole: plan === null ? '' : plan.role,
    memberTotal: total,
    planSource: input.planSource,
    highlightLine: 0,
    briefs: plan === null ? [] : Array.from({ length: total }, (_v, m) => renderBrief(plan, m)),
    slugs: plan === null ? [] : Array.from({ length: total }, (_v, m) => planKey(plan, m)),
    doctor,
    planFindings: plan === null ? [] : doctorPlan(plan),
    run: input.run ?? {
      id: input.runId,
      startedAt: input.startedAt,
      skipped: 0,
      done: 0,
      running: 0,
      failed: 0,
      confirmed: 0,
      members: [],
    },
    budget: input.budget ?? { spendUsd: 0, tokensIn: 0, tokensOut: 0 },
    violations: input.violations,
    daemon: {
      live: true,
      uptimeLabel: formatUptime(input.host.uptimeSec),
      pid: input.host.pid,
      socket: input.socket,
      rssMb: Math.round(input.host.rssBytes / (1024 * 1024)),
      proto: 'v1',
      storeWriters: 1,
    },
    chrome: { gates: input.gates, keys: input.keys },
  };
}
