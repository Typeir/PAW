/**
 * PAW Daemon Slice Cache
 *
 * @fileoverview Snapshot, take apart. Expensive part compute per version of
 * its input, cache it. Plan briefs render once per mtime of plan file. Doctor
 * run once per version of config. Compose read cached pieces. Version number
 * come from caller — an mtime, a counter.
 *
 * Pure. Just `Map`, functions over plain values.
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
  type LogEntry,
  type PawSnapshot,
  type PlanSlice,
  type PlansSlice,
  type RunProgress,
  type SwarmPlan,
  type Violation,
} from '@paw/core';
import { formatUptime } from './snapshot.js';

/**
 * Value cache against version of input it compute from.
 *
 * @interface VersionedCache
 * @property {Function} read - Return cached value, or build and cache it when version move.
 * @property {(key: string) => void} forget - Drop entry, e.g. when its file disappear.
 * @property {() => number} size - How many entry hold.
 */
export interface VersionedCache<V> {
  read(key: string, version: number, build: () => V): V;
  forget(key: string): void;
  size(): number;
}

/**
 * Build cache.
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
 * Plan slice for "no plan selected". Empty lists.
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
 * Render plan into slice for console show. One `renderBrief` and one
 * `planKey` per member, plus plan doctor.
 *
 * @param {SwarmPlan<unknown>} plan - Loaded plan.
 * @param {string} source - Its module source.
 * @param {string} selectedPlan - Repo-relative path it load from.
 * @returns {PlanSlice} Rendered slice.
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
 * The cached pieces a snapshot assemble from.
 *
 * @interface SnapshotParts
 * @property {HostInfo} host - Host fact, read fresh per request.
 * @property {HostProcess[]} processes - Owned process subtree.
 * @property {string} root - Served repository — the current scope.
 * @property {PlansSlice} plans - What repository hold.
 * @property {PlanSlice} planDetail - Plan in view, rendered.
 * @property {DoctorReport} doctor - Config and role doctor.
 * @property {RunProgress} run - Run identity and progress.
 * @property {BudgetSummary} budget - What run spend.
 * @property {Violation[]} violations - Open enforcement violations.
 * @property {string} socket - Bound address.
 * @property {number} gates - Gate count for the rail.
 * @property {number} keys - Provider key count for the rail.
 * @property {LogEntry[]} logs - Log ring entries, oldest first.
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
  readonly logs: readonly LogEntry[];
}

/**
 * Assemble snapshot from its cached parts. Compute nothing here beyond daemon
 * own status line. Every expensive field arrive already built.
 *
 * @param {SnapshotParts} parts - The pieces.
 * @returns {PawSnapshot} Console state.
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
    logs: parts.logs,
    chrome: { gates: parts.gates, keys: parts.keys },
  };
}

/**
 * Run not dispatched. Zeros and empty members list.
 *
 * @param {string} id - Run identifier.
 * @param {string} startedAt - When daemon start.
 * @returns {RunProgress} The empty progress.
 */
export function idleRun(id: string, startedAt: string): RunProgress {
  return { id, startedAt, skipped: 0, done: 0, running: 0, failed: 0, confirmed: 0, members: [] };
}

/**
 * Budget nothing spend from.
 *
 * @returns {BudgetSummary} Empty meter.
 */
export function idleBudget(): BudgetSummary {
  return { spendUsd: 0, tokensIn: 0, tokensOut: 0 };
}
