/**
 * PAW Console Plans Client
 *
 * @fileoverview Plan-file write transport: `POST /api/plans` scaffolds one,
 * `DELETE /api/plans` removes one. The daemon answers only with `--control`;
 * otherwise the refusal comes back for the view to show. Uses the same
 * authenticated {@link FetchLike} as the snapshot source.
 *
 * @module @paw/gui/infrastructure/plansClient
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { FetchLike, ResponseLike } from './snapshotSource.js';

/**
 * Daemon plan-file write endpoint.
 */
export const PLANS_URL = '/api/plans';

/**
 * Outcome of a plan write.
 *
 * @interface PlanWrite
 * @property {boolean} ok - Whether the write took.
 * @property {string} [plan] - Repo-relative plan path the write touched, on success.
 * @property {string} [reason] - Why refused, when it was.
 */
export interface PlanWrite {
  readonly ok: boolean;
  readonly plan?: string;
  readonly reason?: string;
}

/**
 * Plan-file verbs.
 *
 * @interface PlansClient
 * @property {(name: string) => Promise<PlanWrite>} create - Scaffold `plans/<name>.swarm.mjs` from the starter template.
 * @property {(plan: string) => Promise<PlanWrite>} remove - Delete the named plan file.
 */
export interface PlansClient {
  create(name: string): Promise<PlanWrite>;
  remove(plan: string): Promise<PlanWrite>;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/**
 * Turn a write response into an outcome. Success carries the plan path from
 * the body; refusal carries the daemon's reason when the body is JSON, else
 * the status.
 *
 * @param {ResponseLike} response - Write response.
 * @returns {Promise<PlanWrite>} The outcome.
 */
async function writeResult(response: ResponseLike): Promise<PlanWrite> {
  try {
    const body = (await response.json()) as { plan?: unknown; reason?: unknown };
    if (response.ok) {
      return { ok: true, plan: typeof body.plan === 'string' ? body.plan : undefined };
    }
    return {
      ok: false,
      reason: typeof body.reason === 'string' ? body.reason : `HTTP ${response.status}`,
    };
  } catch {
    return response.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status}` };
  }
}

/**
 * Build plans client over authenticated transport.
 *
 * @param {FetchLike} fetchFn - Authenticated transport.
 * @returns {PlansClient} The client.
 */
export function createPlansClient(fetchFn: FetchLike): PlansClient {
  return {
    async create(name: string): Promise<PlanWrite> {
      return writeResult(
        await fetchFn(PLANS_URL, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ name }),
        }),
      );
    },
    async remove(plan: string): Promise<PlanWrite> {
      return writeResult(
        await fetchFn(`${PLANS_URL}?plan=${encodeURIComponent(plan)}`, {
          method: 'DELETE',
          headers: JSON_HEADERS,
        }),
      );
    },
  };
}
