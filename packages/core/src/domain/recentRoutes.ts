/**
 * PAW recent routes.
 *
 * @fileoverview Pure list ops over most-recently-grabbed consumer
 * routes. VS Code "recent projects" list. Remember last few consumers
 * console held. Route names place PAW maybe installed; list carry
 * no liveness. Dead route stay until fall off end. Decide here,
 * persist through {@link RecentRoutesPort}.
 *
 * @module @paw/core/domain/recentRoutes
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/** How many routes recent list keep by default. */
export const RECENT_ROUTES_CAP = 8;

/**
 * Route as dedup key: case-fold, forward-slash. Same
 * repository typed two ways collapse to one entry.
 *
 * @param {string} route - The route.
 * @returns {string} Its comparison key.
 */
function routeKey(route: string): string {
  return route.toLowerCase().replace(/\\/g, '/');
}

/**
 * Whether two routes name same repository, by same case- and
 * slash-insensitive key recent list dedup on.
 *
 * @param {string} a - One route.
 * @param {string} b - The other.
 * @returns {boolean} True when same repository.
 */
export function sameRoute(a: string, b: string): boolean {
  return routeKey(a) === routeKey(b);
}

/**
 * Whether route be absolute path — POSIX `/…` or Windows drive `C:\…` /
 * `C:/…` / UNC `\\…`. Only absolute routes belong in recent list: relative
 * one (`.`, `foo`) name nothing once cwd change.
 *
 * @param {string} route - The route.
 * @returns {boolean} True when absolute.
 */
export function isAbsoluteRoute(route: string): boolean {
  return /^([A-Za-z]:[\\/]|[\\/])/.test(route.trim());
}

/**
 * Put route at front of recent list: drop any earlier entry for
 * same repository, prepend this one, keep at most `cap`. Blank or
 * relative route no-op — list hold absolute paths only.
 *
 * @param {readonly string[]} list - Current recent list, newest first.
 * @param {string} route - Route just grabbed.
 * @param {number} [cap] - Most to keep; default {@link RECENT_ROUTES_CAP}.
 * @returns {string[]} Next list, newest first.
 */
export function promoteRoute(
  list: readonly string[],
  route: string,
  cap: number = RECENT_ROUTES_CAP,
): string[] {
  if (route.trim() === '' || !isAbsoluteRoute(route)) {
    return [...list];
  }
  const key = routeKey(route);
  return [route, ...list.filter((entry) => routeKey(entry) !== key)].slice(0, cap);
}

/**
 * Drop route from recent list, by same key dedup use. Unknown route no-op.
 *
 * @param {readonly string[]} list - Current recent list, newest first.
 * @param {string} route - Route to forget.
 * @returns {string[]} Next list, order kept.
 */
export function removeRoute(list: readonly string[], route: string): string[] {
  const key = routeKey(route);
  return list.filter((entry) => routeKey(entry) !== key);
}