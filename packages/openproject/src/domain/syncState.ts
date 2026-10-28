/**
 * PAW OpenProject Sync State
 *
 * @fileoverview The sidecar `.paw/openproject.sync.json`: the instance and project last synced and
 * the delta cursor, the newest `updatedAt` seen. A missing sidecar, or one naming another
 * instance or project, makes the next sync a full sweep.
 *
 * @module @paw/openproject/domain/syncState
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Repository-relative path of the sidecar.
 *
 * @constant
 */
export const STATE_FILE = '.paw/openproject.sync.json';

/**
 * What the last sync recorded.
 *
 * @interface SyncState
 * @property {string} baseUrl - Instance origin the cursor belongs to.
 * @property {string} project - Project the cursor belongs to.
 * @property {string | null} cursor - Newest `updatedAt` seen; null when the project held nothing.
 */
export interface SyncState {
  readonly baseUrl: string;
  readonly project: string;
  readonly cursor: string | null;
}

/**
 * Outcome of parsing the sidecar.
 */
export type StateParse =
  | { readonly ok: true; readonly state: SyncState | null }
  | { readonly ok: false; readonly reason: string };

/**
 * Whether a parsed value has the {@link SyncState} shape.
 *
 * @param {unknown} value - Parsed JSON.
 * @returns {boolean} True for a state.
 */
function isState(value: unknown): value is SyncState {
  const state = value as Partial<Record<keyof SyncState, unknown>> | null;
  return (
    typeof value === 'object' &&
    state !== null &&
    typeof state.baseUrl === 'string' &&
    typeof state.project === 'string' &&
    (typeof state.cursor === 'string' || state.cursor === null)
  );
}

/**
 * The state the sidecar holds.
 *
 * @param {string} text - Sidecar text; blank is no state.
 * @returns {StateParse} The state or null, or a refusal.
 */
export function parseSyncState(text: string): StateParse {
  if (text.trim() === '') {
    return { ok: true, state: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: `${STATE_FILE} is not valid JSON: ${String(err)}` };
  }
  if (!isState(parsed)) {
    return {
      ok: false,
      reason: `${STATE_FILE} needs a string baseUrl and project and a string or null cursor; delete it to force a full sync`,
    };
  }
  return { ok: true, state: { baseUrl: parsed.baseUrl, project: parsed.project, cursor: parsed.cursor } };
}

/**
 * The sidecar text of a state.
 *
 * @param {SyncState} state - State to write.
 * @returns {string} 2-space JSON with a trailing newline.
 */
export function serializeSyncState(state: SyncState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}
