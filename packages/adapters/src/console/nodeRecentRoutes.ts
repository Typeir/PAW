/**
 * PAW Node Recent Routes Adapter
 *
 * @fileoverview The {@link RecentRoutesPort} over `node:fs`, persisting the
 * console's recently-grabbed routes in `recent.json` under PAW home. An absent
 * file reads as no routes; a malformed one — not a JSON array of strings — fails
 * loud rather than being silently discarded. Recording promotes the route through
 * the pure {@link promoteRoute} and writes the whole list back.
 *
 * @module @paw/adapters/console/nodeRecentRoutes
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { RECENT_ROUTES_CAP, promoteRoute, type RecentRoutesPort } from '@paw/core';

/**
 * A recent-routes port persisted at `<home>/recent.json`.
 *
 * @param {string} home - The PAW home directory.
 * @param {number} [cap] - The most routes to keep; defaults to the shared cap.
 * @returns {RecentRoutesPort} The port.
 */
export function createNodeRecentRoutes(
  home: string,
  cap: number = RECENT_ROUTES_CAP,
): RecentRoutesPort {
  const file = resolve(home, 'recent.json');
  const read = async (): Promise<string[]> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
        throw new Error(`recent routes at ${file} are not a list of paths`);
      }
      return parsed as string[];
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  };
  return {
    list: read,
    async record(route: string): Promise<string[]> {
      const next = promoteRoute(await read(), route, cap);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      return next;
    },
  };
}
