/**
 * PAW Console Recent Routes Client
 *
 * @fileoverview Scope picker read transport: get recently grabbed routes from
 * `GET /api/recent`. A route may name a PAW install, not a running daemon.
 * Read the plain list; never probe liveness. The grab is a one-shot snapshot
 * frame from the live daemon, not a stream.
 * Client only reads. Uses same authenticated {@link FetchLike} as snapshot source.
 * It holds no credential.
 *
 * @module @paw/gui/infrastructure/recentClient
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { FetchLike, ResponseLike } from './snapshotSource.js';

/**
 * Daemon recent-routes read endpoint.
 */
export const RECENT_URL = '/api/recent';

/**
 * Scope picker verbs: read list, forget stale entry.
 *
 * @interface RecentClient
 * @property {() => Promise<readonly string[]>} list - Recent grabbed routes, newest first.
 * @property {(route: string) => Promise<readonly string[]>} remove - Forget route; give back new list.
 */
export interface RecentClient {
  list(): Promise<readonly string[]>;
  remove(route: string): Promise<readonly string[]>;
}

/**
 * Build recent-routes client over authenticated transport.
 *
 * @param {FetchLike} fetchFn - Authenticated transport.
 * @returns {RecentClient} The client.
 */
export function createRecentClient(fetchFn: FetchLike): RecentClient {
  const parse = async (response: ResponseLike, what: string): Promise<readonly string[]> => {
    if (!response.ok) {
      throw new Error(`PAW console: ${what} responded ${response.status}`);
    }
    return (await response.json()) as readonly string[];
  };
  return {
    async list(): Promise<readonly string[]> {
      return parse(await fetchFn(RECENT_URL), RECENT_URL);
    },
    async remove(route: string): Promise<readonly string[]> {
      const url = `${RECENT_URL}?route=${encodeURIComponent(route)}`;
      return parse(await fetchFn(url, { method: 'DELETE' }), url);
    },
  };
}
