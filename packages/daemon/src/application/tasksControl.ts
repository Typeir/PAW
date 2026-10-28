/**
 * PAW Tasks Control Port
 *
 * @fileoverview Console verb that syncs the repository's backend connectors into its task
 * document, applied in the daemon unless `--read-only`. One sync runs at a time; a second request
 * while one runs answers 409. Per-connector refusals are data in a 200 answer; a sync that throws
 * answers 500.
 *
 * @module @paw/daemon/tasksControl
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { BackendSyncReport } from '@paw/core';
import type { ControlPort, ControlResult } from '../domain/control.js';

/**
 * Run the sync, mapping a throw to a 500 result.
 *
 * @param {(full: boolean) => Promise<readonly BackendSyncReport[]>} sync - Sync every enabled backend.
 * @param {boolean} full - Force a full sweep.
 * @returns {Promise<ControlResult>} 200 with the reports, or 500 with the message.
 */
async function attempt(
  sync: (full: boolean) => Promise<readonly BackendSyncReport[]>,
  full: boolean,
): Promise<ControlResult> {
  try {
    return { status: 200, body: { ok: true, reports: await sync(full) } };
  } catch (err: unknown) {
    return { status: 500, body: { ok: false, reason: err instanceof Error ? err.message : String(err) } };
  }
}

/**
 * Build the control port: `POST /api/tasks/sync` with an optional boolean `full`.
 *
 * @param {(full: boolean) => Promise<readonly BackendSyncReport[]>} sync - Sync every enabled backend of the served repository.
 * @returns {ControlPort} Registered writes.
 */
export function tasksControl(sync: (full: boolean) => Promise<readonly BackendSyncReport[]>): ControlPort {
  let running = false;
  return {
    handlers: {
      'POST /api/tasks/sync': async ({ body }) => {
        if (body.full !== undefined && typeof body.full !== 'boolean') {
          return { status: 422, body: { ok: false, reason: 'full must be a boolean' } };
        }
        if (running) {
          return { status: 409, body: { ok: false, reason: 'a sync is already running; wait for it to finish' } };
        }
        running = true;
        const result = await attempt(sync, body.full === true);
        running = false;
        return result;
      },
    },
  };
}
