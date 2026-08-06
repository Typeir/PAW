/**
 * PAW Installer Repo Discovery
 *
 * @fileoverview Finds the repository PAW is being attached to, from anywhere
 * inside it, by walking up to the nearest `.git`. Pure: the existence check is
 * injected, so the walk is a unit test and `main.ts` supplies the real
 * `fs.existsSync`. This is what lets `paw init` be run from any subdirectory and
 * still attach PAW at the repo root — without PAW itself living in the repo.
 *
 * @module @paw/installer/repo
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { dirname, join } from 'node:path';

/**
 * Walk up from a starting directory to the nearest ancestor containing `.git`.
 *
 * @param {string} start - The directory to begin from (e.g. `process.cwd()`).
 * @param {(path: string) => boolean} exists - Existence predicate for a path.
 * @returns {string | null} The repo root, or null when none is found.
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
