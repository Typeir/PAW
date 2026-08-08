/**
 * PAW Console Page Location
 *
 * @fileoverview Finds the built React console the daemon serves. This is a
 * packaging question, not a runtime one, which is why it lives beside the
 * runtime rather than inside it: `nodeRuntime` serves whatever page it is
 * handed, and every shell that starts a daemon — `paw ui`, `pawd`, the Electron
 * main process — decides which one that is here.
 *
 * The console is a single self-contained file (`@paw/gui` inlines React and its
 * whole bundle into one page), so locating it is locating one file rather than
 * an asset tree. It sits in two places depending on how PAW was started, and
 * neither is knowable from a path constant: beside the bundle in a built
 * artifact, and under `packages/gui/dist` in a source checkout. So both are
 * probed, in that order.
 *
 * Resolution is relative to this module, which lands correctly in both layouts
 * without any shell passing an argument — a console the operator has to locate
 * by hand is not a console.
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
 * The console page's filename. `live.html` is the target `@paw/gui` builds with
 * no snapshot injected, so it fetches `/api/state` from the daemon rather than
 * rendering a frozen demo.
 */
export const CONSOLE_PAGE_FILE = 'live.html';

/**
 * Where the console sits, given the directory the running module occupies.
 *
 * Pure over an injected existence check so both layouts are tested from either
 * one. When the page is in neither place the preferred location is returned
 * rather than null: the caller reports the miss by path, and the path it names
 * should be where the file belongs rather than the last place that was tried.
 *
 * @param {string} moduleDir - Directory of the running module.
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
 * Where the console sits for this installation.
 *
 * @returns {string} The console page path.
 */
export function consolePage(): string {
  return resolveConsolePage(
    dirname(fileURLToPath(import.meta.url)),
    existsSync,
  );
}
