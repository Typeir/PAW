/**
 * PAW Installer Repo Discovery
 *
 * @fileoverview Find repo PAW attach to, from anywhere inside it. Walk up to
 * nearest `.git`. Pure: existence check injected. Unit test injects `exists`;
 * `main.ts` passes `fs.existsSync`. `paw init` runs from any subdirectory and
 * attaches PAW at repo root — PAW not live in the repo.
 *
 * @module @paw/installer/repo
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { dirname, join } from 'node:path';

/**
 * Walk up from starting dir to nearest ancestor hold `.git`.
 *
 * @param {string} start - Dir to begin from (e.g. `process.cwd()`).
 * @param {(path: string) => boolean} exists - Existence predicate for path.
 * @returns {string | null} Repo root, or null when none found.
 */
export function findRepoRoot(
  start: string,
  exists: (path: string) => boolean,
): string | null {
  let dir = start;
  for (;;) {
    if (exists(join(dir, '.git'))) {
      return dir;
    }
    const up = dirname(dir);
    if (up === dir) {
      return null;
    }
    dir = up;
  }
}
