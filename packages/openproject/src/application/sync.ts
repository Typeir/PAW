/**
 * PAW OpenProject Sync
 *
 * @fileoverview One sync over file texts the caller reads and writes: env, sidecar, and task
 * document in; new task document and sidecar out. A delta runs only when the sidecar names the
 * same instance and project and holds a cursor; otherwise, or when `full` is set, a full sweep
 * runs and removes owned tasks the backend no longer returns.
 *
 * @module @paw/openproject/application/sync
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { parseBackendEnv, type BackendConfig } from '../domain/backendEnv.js';
import { parseSyncState, serializeSyncState, type SyncState } from '../domain/syncState.js';
import { parseTaskDocument, writeRecords, type WriteMode } from '../domain/taskDocument.js';
import { pullWorkPackages, type FetchLike } from './pull.js';

/**
 * Inputs to one sync.
 *
 * @interface SyncInput
 * @property {string} env - `.paw/openproject.backend.env` text.
 * @property {string} state - `.paw/openproject.sync.json` text; blank when absent.
 * @property {string} document - `.paw/tasks.json` text; blank when absent.
 * @property {boolean} full - Force a full sweep.
 * @property {FetchLike} fetch - Fetch to reach the instance with.
 */
export interface SyncInput {
  readonly env: string;
  readonly state: string;
  readonly document: string;
  readonly full: boolean;
  readonly fetch: FetchLike;
}

/**
 * Outcome of a sync. Nothing is written on a refusal.
 */
export type SyncResult =
  | {
      readonly ok: true;
      readonly document: string;
      readonly state: string;
      readonly mode: WriteMode;
      readonly pulled: number;
      readonly removed: number;
      readonly refusals: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

/**
 * The cursor a delta may start from.
 *
 * @param {SyncState | null} state - Parsed sidecar.
 * @param {BackendConfig} config - Backend connection.
 * @param {boolean} full - Full sweep forced.
 * @returns {string | null} The cursor, or null for a full sweep.
 */
function deltaCursor(state: SyncState | null, config: BackendConfig, full: boolean): string | null {
  const same = state !== null && state.baseUrl === config.baseUrl && state.project === config.project;
  return full || !same ? null : state.cursor;
}

/**
 * Sync the project into the task document.
 *
 * @param {SyncInput} input - File texts, mode, and fetch.
 * @returns {Promise<SyncResult>} New file texts and counts, or a refusal.
 */
export async function sync(input: SyncInput): Promise<SyncResult> {
  const env = parseBackendEnv(input.env);
  if (!env.ok) {
    return env;
  }
  const state = parseSyncState(input.state);
  if (!state.ok) {
    return state;
  }
  const document = parseTaskDocument(input.document);
  if (!document.ok) {
    return document;
  }
  const since = deltaCursor(state.state, env.config, input.full);
  const mode: WriteMode = since === null ? 'full' : 'delta';
  const pulled = await pullWorkPackages(input.fetch, env.config, since);
  if (!pulled.ok) {
    return pulled;
  }
  const written = writeRecords(document.document, pulled.records, mode);
  return {
    ok: true,
    document: written.text,
    state: serializeSyncState({ baseUrl: env.config.baseUrl, project: env.config.project, cursor: pulled.cursor }),
    mode,
    pulled: written.written,
    removed: written.removed,
    refusals: pulled.refusals,
  };
}
