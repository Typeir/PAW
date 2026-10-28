/**
 * PAW Backend Sync Plan
 *
 * @fileoverview Which enabled backend connectors can sync, and through which module. A backend
 * syncs through the module {@link BACKEND_SYNC} names for it; one with no route, or whose module
 * is not enabled, is refused with the verb that fixes it.
 *
 * @module @paw/core/domain/backendSync
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ConfigDocument } from './config.js';
import { enabledConnectorIds, VENDOR_CONNECTORS } from './connectors.js';
import { enabledModuleIds, VENDOR_MODULES, type ModuleEntry } from './modules.js';

/**
 * One route: a backend connector and the module that implements its sync.
 *
 * @interface BackendRoute
 * @property {string} connector - Backend connector id.
 * @property {string} module - Module id exporting `backend`.
 */
export interface BackendRoute {
  readonly connector: string;
  readonly module: string;
}

/**
 * Sync routes this build ships.
 *
 * @constant
 * @type {readonly BackendRoute[]}
 */
export const BACKEND_SYNC: readonly BackendRoute[] = [{ connector: 'openproject', module: 'paw-openproject' }];

/**
 * One planned sync, or why a connector cannot sync.
 */
export type BackendSyncStep =
  | { readonly ok: true; readonly connector: string; readonly module: ModuleEntry }
  | { readonly ok: false; readonly connector: string; readonly reason: string };

/**
 * One connector's sync outcome, as a shell reports it.
 */
export type BackendSyncReport =
  | {
      readonly connector: string;
      readonly ok: true;
      readonly mode: 'full' | 'delta';
      readonly pulled: number;
      readonly removed: number;
      readonly refusals: readonly string[];
    }
  | { readonly connector: string; readonly ok: false; readonly reason: string };

/**
 * Repository-relative path of the host's sync log: the last report per connector.
 *
 * @constant
 */
export const SYNC_LOG_FILE = '.paw/backend-sync.json';

/**
 * A connector's last sync attempt.
 *
 * @interface LastSync
 * @property {string} at - ISO time the attempt finished.
 * @property {BackendSyncReport} report - What it reported.
 */
export interface LastSync {
  readonly at: string;
  readonly report: BackendSyncReport;
}

/**
 * Outcome of parsing the sync log.
 */
export type SyncLogParse =
  | { readonly ok: true; readonly last: Readonly<Record<string, LastSync>> }
  | { readonly ok: false; readonly reason: string };

/**
 * Whether a parsed value has the {@link LastSync} shape.
 *
 * @param {unknown} value - One log entry.
 * @returns {boolean} True for a string `at` and a report with a string connector and a boolean ok.
 */
function isLastSync(value: unknown): value is LastSync {
  const entry = value as { at?: unknown; report?: { ok?: unknown; connector?: unknown } | null } | null;
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof entry.at === 'string' &&
    typeof entry.report === 'object' &&
    entry.report !== null &&
    typeof entry.report.ok === 'boolean' &&
    typeof entry.report.connector === 'string'
  );
}

/**
 * The last sync per connector the log holds.
 *
 * @param {string} text - Log text; blank is no syncs.
 * @returns {SyncLogParse} Entries by connector, or a refusal naming the file.
 */
export function parseSyncLog(text: string): SyncLogParse {
  let parsed: unknown;
  try {
    parsed = text.trim() === '' ? {} : JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: `${SYNC_LOG_FILE} is not valid JSON: ${String(err)}` };
  }
  const entries = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? Object.values(parsed) : [0];
  if (!entries.every(isLastSync)) {
    return {
      ok: false,
      reason: `${SYNC_LOG_FILE} holds an entry that is not a sync record; delete it and sync again`,
    };
  }
  return { ok: true, last: parsed as Record<string, LastSync> };
}

/**
 * The log text after a round of syncs: each report replaces its connector's entry.
 *
 * @param {Readonly<Record<string, LastSync>>} last - Current entries.
 * @param {readonly BackendSyncReport[]} reports - Reports to record.
 * @param {string} at - ISO time the round finished.
 * @returns {string} 2-space JSON with a trailing newline.
 */
export function recordSyncs(
  last: Readonly<Record<string, LastSync>>,
  reports: readonly BackendSyncReport[],
  at: string,
): string {
  const next: Record<string, LastSync> = { ...last };
  for (const report of reports) {
    next[report.connector] = { at, report };
  }
  return `${JSON.stringify(next, null, 2)}\n`;
}

/**
 * One enabled backend as a freshness panel shows it.
 *
 * @interface BackendFreshness
 * @property {string} connector - Backend connector id.
 * @property {boolean} ready - Whether its sync can run under this config.
 * @property {string | null} reason - Why it cannot, with the verb that fixes it; null when ready.
 * @property {LastSync | null} last - Its last sync attempt; null when never synced.
 */
export interface BackendFreshness {
  readonly connector: string;
  readonly ready: boolean;
  readonly reason: string | null;
  readonly last: LastSync | null;
}

/**
 * Every enabled backend with whether it can sync and its last attempt.
 *
 * @param {ConfigDocument} config - The config document.
 * @param {Readonly<Record<string, LastSync>>} last - Sync log entries.
 * @returns {BackendFreshness[]} One entry per enabled backend, catalogue order.
 */
export function backendFreshness(
  config: ConfigDocument,
  last: Readonly<Record<string, LastSync>>,
): BackendFreshness[] {
  return backendSyncPlan(config).map((step) => ({
    connector: step.connector,
    ready: step.ok,
    reason: step.ok ? null : step.reason,
    last: last[step.connector] ?? null,
  }));
}

/**
 * An ISO time as `YYYY-MM-DD HH:MM UTC`.
 *
 * @param {string} at - ISO time in UTC, as `Date#toISOString` writes it.
 * @returns {string} The minute it names.
 */
function minuteOf(at: string): string {
  return `${at.slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * One line of a backend's freshness, as every surface prints it.
 *
 * @param {BackendFreshness} backend - The backend.
 * @returns {string} Why it cannot sync, that it never synced, its last refusal, or when and how it last synced.
 */
export function freshnessText(backend: BackendFreshness): string {
  if (!backend.ready) {
    return `cannot sync: ${backend.reason as string}`;
  }
  if (backend.last === null) {
    return 'never synced';
  }
  const { at, report } = backend.last;
  if (!report.ok) {
    return `last sync refused ${minuteOf(at)}: ${report.reason}`;
  }
  const skipped = report.refusals.length === 0 ? '' : ` · ${report.refusals.length} skipped`;
  return `synced ${minuteOf(at)} · ${report.mode} · ${report.pulled} pulled, ${report.removed} removed${skipped}`;
}

/**
 * Plan a sync of every enabled backend connector.
 *
 * @param {ConfigDocument} config - The config document.
 * @returns {BackendSyncStep[]} One step per enabled backend, catalogue order; empty when none is enabled.
 */
export function backendSyncPlan(config: ConfigDocument): BackendSyncStep[] {
  const connectors = new Set(enabledConnectorIds(config));
  const modules = new Set(enabledModuleIds(config));
  return VENDOR_CONNECTORS.filter((entry) => entry.kind === 'backend' && connectors.has(entry.id)).map(
    ({ id }): BackendSyncStep => {
      const route = BACKEND_SYNC.find((candidate) => candidate.connector === id);
      if (route === undefined) {
        return {
          ok: false,
          connector: id,
          reason: `connector "${id}" has no sync module in this build; disable it with paw connectors disable ${id}`,
        };
      }
      if (!modules.has(route.module)) {
        return {
          ok: false,
          connector: id,
          reason: `connector "${id}" syncs through module ${route.module}; enable it with paw modules enable ${route.module}`,
        };
      }
      return {
        ok: true,
        connector: id,
        module: VENDOR_MODULES.find((entry) => entry.id === route.module) as ModuleEntry,
      };
    },
  );
}
