/**
 * PAW Node Recent Routes Adapter
 *
 * @fileoverview {@link RecentRoutesPort} over `node:fs`. Save console recently-grabbed
 * routes in `recent.json` under PAW home. No file mean no routes. Malformed file — no
 * JSON array of strings — throw. Record push route through {@link promoteRoute} and write
 * whole list back.
 *
 * @module @paw/adapters/console/nodeRecentRoutes
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { RECENT_ROUTES_CAP, promoteRoute, removeRoute, type RecentRoutesPort } from '@paw/core';

/**
 * Recent-routes port persist at `<home>/recent.json`.
 *
 * @param {string} home - PAW home directory.
 * @param {number} [cap] - Most routes to keep. Default to shared cap.
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
  const write = async (next: string[]): Promise<string[]> => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  };
  return {
    list: read,
    async record(route: string): Promise<string[]> {
      return write(promoteRoute(await read(), route, cap));
    },
    async remove(route: string): Promise<string[]> {
      return write(removeRoute(await read(), route));
    },
  };
}
