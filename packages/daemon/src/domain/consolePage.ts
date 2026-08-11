/**
 * PAW Console Page Location
 *
 * @fileoverview Find built React console daemon serve. `nodeRuntime`
 * serve page it get handed. Every shell that start daemon — `paw ui`,
 * `pawd`, Electron main process — pick page here. `@paw/gui` inline
 * React and whole bundle into one self-contained file, so find console find
 * one file. Located in two places depending on how PAW starts: beside bundle in built artifact,
 * and under `packages/gui/dist` in source checkout.
 * Probe both, that order. Resolution is relative to this module, correct in
 * both layouts, no shell argument needed.
 *
 * @module @paw/daemon/consolePage
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Console page filename. `live.html` be target `@paw/gui` build with
 * no snapshot inject, so it fetch `/api/state` from daemon, no render frozen
 * demo.
 */
export const CONSOLE_PAGE_FILE = 'live.html';

/**
 * Location of console, relative to the directory the running module occupies.
 *
 * Takes an injected existence check, so either layout can be tested
 * from any module directory. When the page exists nowhere, returns the
 * preferred location: the caller reports the miss with that path,
 * naming where the file belongs, not the last place tried.
 *
 * @param {string} moduleDir - Directory of running module.
 * @param {(path: string) => boolean} exists - Whether a path exists.
 * @returns {string} The console page path.
 */
export function resolveConsolePage(
  moduleDir: string,
  exists: (path: string) => boolean,
): string {
  const candidates = [
    join(moduleDir, 'gui', CONSOLE_PAGE_FILE),
    join(moduleDir, '..', '..', '..', 'gui', 'dist', CONSOLE_PAGE_FILE),
  ];
  return candidates.find(exists) ?? candidates[0];
}

/**
 * Location of console for this installation.
 *
 * @returns {string} The console page path.
 */
export function consolePage(): string {
  return resolveConsolePage(
    dirname(fileURLToPath(import.meta.url)),
    existsSync,
  );
}
