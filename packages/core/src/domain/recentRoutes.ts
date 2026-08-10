/**
 * PAW Recent Routes
 *
 * @fileoverview The most-recently-grabbed consumer routes, as a pure list
 * operation. A console grabs one consumer at a time; this remembers the last few
 * it held so an operator can jump back without retyping the path — the VS Code
 * "recent projects" list. What a route names is a place PAW may be installed, not
 * a daemon that happens to be running, so the list carries no liveness: a dead
 * route stays until it falls off the end. Decided here, persisted through
 * {@link RecentRoutesPort}.
 *
 * @module @paw/core/domain/recentRoutes
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/** How many routes the recent list keeps by default. */
export const RECENT_ROUTES_CAP = 8;

/**
 * A route as its dedup key: case-folded and forward-slashed, so the same
 * repository typed two ways collapses to one entry.
 *
 * @param {string} route - The route.
 * @returns {string} Its comparison key.
 */
function routeKey(route: string): string {
  return route.toLowerCase().replace(/\\/g, '/');
}

/**
 * Whether two routes name the same repository, by the same case- and
 * slash-insensitive key the recent list dedups on — so "which route is the
 * current scope" agrees with how the list was built.
 *
 * @param {string} a - One route.
 * @param {string} b - The other.
 * @returns {boolean} True when they are the same repository.
 */
export function sameRoute(a: string, b: string): boolean {
  return routeKey(a) === routeKey(b);
}

/**
 * Put a route at the front of the recent list: drop any earlier entry for the
 * same repository, prepend this one, and keep at most `cap`. A blank route is a
 * no-op, so recording the daemon's boot scope never seeds an empty entry.
 *
 * @param {readonly string[]} list - The current recent list, newest first.
 * @param {string} route - The route just grabbed.
 * @param {number} [cap] - The most to keep; defaults to {@link RECENT_ROUTES_CAP}.
 * @returns {string[]} The next list, newest first.
 */
export function promoteRoute(
  list: readonly string[],
  route: string,
  cap: number = RECENT_ROUTES_CAP,
): string[] {
  if (route.trim() === '') {
    return [...list];
  }
  const key = routeKey(route);
  return [route, ...list.filter((entry) => routeKey(entry) !== key)].slice(0, cap);
}
