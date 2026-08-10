/**
 * PAW Console Recent Routes Client
 *
 * @fileoverview The scope picker's read transport: the routes the console has
 * recently grabbed, from `GET /api/recent`. A route is a place PAW may be
 * installed, not a daemon that is running, so this reads a plain list and never
 * probes liveness. The grab itself is a live-wire frame, not a request, so this
 * client only reads. The transport is the same authenticated {@link FetchLike}
 * the snapshot source uses, so the credential is never handled here.
 *
 * @module @paw/gui/infrastructure/recentClient
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { FetchLike } from './snapshotSource.js';

/**
 * The daemon's recent-routes read endpoint.
 */
export const RECENT_URL = '/api/recent';

/**
 * The scope picker's read verb.
 *
 * @interface RecentClient
 * @property {() => Promise<readonly string[]>} list - The recently-grabbed routes, newest first.
 */
export interface RecentClient {
  list(): Promise<readonly string[]>;
}

/**
 * Build a recent-routes client over an authenticated transport.
 *
 * @param {FetchLike} fetchFn - The authenticated transport.
 * @returns {RecentClient} The client.
 */
export function createRecentClient(fetchFn: FetchLike): RecentClient {
  return {
    async list(): Promise<readonly string[]> {
      const response = await fetchFn(RECENT_URL);
      if (!response.ok) {
        throw new Error(`PAW console: ${RECENT_URL} responded ${response.status}`);
      }
      return (await response.json()) as readonly string[];
    },
  };
}
