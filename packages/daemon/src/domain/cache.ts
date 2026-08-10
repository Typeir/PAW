/**
 * PAW Daemon Slice Cache
 *
 * @fileoverview The snapshot, taken apart.
 *
 * `buildSnapshot` rebuilt the world on every read: it re-rendered a brief and a
 * resume key for every member and re-ran the doctor, per request, per open
 * console. For a plan with a few hundred members that is hundreds of template
 * renders every three seconds to produce a value that is, almost always,
 * byte-identical to the last one.
 *
 * So the expensive parts are computed **per version of their input** and cached:
 * a plan's briefs are rendered once per mtime of the plan file, the doctor runs
 * once per version of the config, and a read composes the cached pieces. Version
 * numbers come from the caller — an mtime, a counter — because deciding what
 * "changed" means is the caller's job, and caching against a guess is how a
 * console ends up showing yesterday's plan.
 *
 * Pure: a `Map`, and functions over plain values. What is cached is verified by
 * counting calls to the builder, which is the only honest way to test a cache —
 * asserting the value came back is not evidence it was not recomputed.
 *
 * @module @paw/daemon/cache
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  doctorPlan,
  memberCount,
  planKey,
  renderBrief,
  type BudgetSummary,
  type DoctorReport,
  type HostInfo,
  type HostProcess,
  type PawSnapshot,
  type PlanSlice,
  type PlansSlice,
  type RunProgress,
  type SwarmPlan,
  type Violation,
} from '@paw/core';
import { formatUptime } from './snapshot.js';

/**
 * A value cached against the version of the input it was computed from.
 *
 * @interface VersionedCache
 * @property {Function} read - Return the cached value, or build and cache it when the version moved.
 * @property {(key: string) => void} forget - Drop an entry, e.g. when its file disappeared.
 * @property {() => number} size - How many entries are held.
 */
export interface VersionedCache<V> {
  read(key: string, version: number, build: () => V): V;
  forget(key: string): void;
  size(): number;
}

/**
 * Build a cache.
 *
 * @returns {VersionedCache} The cache.
 */
export function createVersionedCache<V>(): VersionedCache<V> {
  const entries = new Map<string, { version: number; value: V }>();
  return {
    read: (key: string, version: number, build: () => V): V => {
      const held = entries.get(key);
      if (held !== undefined && held.version === version) {
        return held.value;
      }
      const value = build();
      entries.set(key, { version, value });
      return value;
    },
    forget: (key: string): void => {
      entries.delete(key);
    },
    size: (): number => entries.size,
  };
}

/**
 * The plan slice for "no plan selected". A console with nothing chosen shows
 * empty lists rather than the last plan's briefs, which is the truth.
 *
 * @returns {PlanSlice} The empty slice.
 */
export function emptyPlanSlice(): PlanSlice {
  return {
    selectedPlan: null,
    planName: '',
    planRole: '',
    memberTotal: 0,
    planSource: '',
    highlightLine: 0,
    briefs: [],
    slugs: [],
    planFindings: [],
  };
}

/**
 * Render a plan into the slice the console shows. This is the expensive call the
 * cache exists to avoid: one `renderBrief` and one `planKey` per member, plus
 * the plan doctor.
 *
 * @param {SwarmPlan<unknown>} plan - The loaded plan.
 * @param {string} source - Its module source.
 * @param {string} selectedPlan - The repo-relative path it was loaded from.
 * @returns {PlanSlice} The rendered slice.
 */
export function buildPlanSlice<Args>(
  plan: SwarmPlan<Args>,
  source: string,
  selectedPlan: string,
): PlanSlice {
  const total = memberCount(plan);
  return {
    selectedPlan,
    planName: plan.name,
    planRole: plan.role,
    memberTotal: total,
    planSource: source,
    highlightLine: 0,
    briefs: Array.from({ length: total }, (_value, member) => renderBrief(plan, member)),
    slugs: Array.from({ length: total }, (_value, member) => planKey(plan, member)),
    planFindings: doctorPlan(plan),
  };
}

/**
 * The cached pieces a snapshot is assembled from.
 *
 * @interface SnapshotParts
 * @property {HostInfo} host - Host facts, read fresh per request.
 * @property {HostProcess[]} processes - The owned process subtree.
 * @property {string} root - The served repository — the current scope.
 * @property {PlansSlice} plans - What the repository holds.
 * @property {PlanSlice} planDetail - The plan in view, rendered.
 * @property {DoctorReport} doctor - The config and role doctor.
 * @property {RunProgress} run - Run identity and progress.
 * @property {BudgetSummary} budget - What the run has spent.
 * @property {Violation[]} violations - Open enforcement violations.
 * @property {string} socket - The bound address.
 * @property {number} gates - Gate count for the rail.
 * @property {number} keys - Provider key count for the rail.
 */
export interface SnapshotParts {
  readonly host: HostInfo;
  readonly processes: readonly HostProcess[];
  readonly root: string;
  readonly plans: PlansSlice;
  readonly planDetail: PlanSlice;
  readonly doctor: DoctorReport;
  readonly run: RunProgress;
  readonly budget: BudgetSummary;
  readonly violations: readonly Violation[];
  readonly socket: string;
  readonly gates: number;
  readonly keys: number;
}

/**
 * Assemble a snapshot from its cached parts. Nothing is computed here beyond the
 * daemon's own status line — every expensive field arrives already built, which
 * is the point.
 *
 * @param {SnapshotParts} parts - The pieces.
 * @returns {PawSnapshot} The console state.
 */
export function composeSnapshot(parts: SnapshotParts): PawSnapshot {
  return {
    host: parts.host,
    processes: parts.processes,
    root: parts.root,
    configPath: parts.plans.configPath,
    plans: parts.plans.plans,
    selectedPlan: parts.planDetail.selectedPlan,
    planName: parts.planDetail.planName,
    planRole: parts.planDetail.planRole,
    memberTotal: parts.planDetail.memberTotal,
    planSource: parts.planDetail.planSource,
    highlightLine: parts.planDetail.highlightLine,
    briefs: parts.planDetail.briefs,
    slugs: parts.planDetail.slugs,
    doctor: parts.doctor,
    planFindings: parts.planDetail.planFindings,
    run: parts.run,
    budget: parts.budget,
    violations: parts.violations,
    daemon: {
      live: true,
      uptimeLabel: formatUptime(parts.host.uptimeSec),
      pid: parts.host.pid,
      socket: parts.socket,
      rssMb: Math.round(parts.host.rssBytes / (1024 * 1024)),
      proto: 'v1',
      storeWriters: 1,
    },
    chrome: { gates: parts.gates, keys: parts.keys },
  };
}

/**
 * A run that has not been dispatched: zeros and an empty herd, which is the
 * truth rather than a plausible fiction.
 *
 * @param {string} id - The run identifier.
 * @param {string} startedAt - When the daemon started.
 * @returns {RunProgress} The empty progress.
 */
export function idleRun(id: string, startedAt: string): RunProgress {
  return { id, startedAt, skipped: 0, done: 0, running: 0, failed: 0, confirmed: 0, members: [] };
}

/**
 * A budget nothing has been spent from.
 *
 * @returns {BudgetSummary} The empty meter.
 */
export function idleBudget(): BudgetSummary {
  return { spendUsd: 0, tokensIn: 0, tokensOut: 0 };
}
