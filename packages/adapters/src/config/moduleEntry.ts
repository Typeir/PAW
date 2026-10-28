/**
 * Node Module Entry
 *
 * @fileoverview Imports a resolved module's `src/index.ts`, the entry every PAW module ships.
 * The import runs the module's code in this process and is cached by path for its lifetime.
 *
 * @module @paw/adapters/config/moduleEntry
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * A loaded entry, or why it did not load.
 */
export type EntryLoad =
  | { readonly ok: true; readonly entry: string; readonly exports: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly detail: string };

/**
 * Import the entry beside a module manifest.
 *
 * @param {string} manifest - Path to the module's `package.json`.
 * @returns {Promise<EntryLoad>} The entry path and its exports, or `<entry> failed to load: <error>`.
 */
export async function importModuleEntry(manifest: string): Promise<EntryLoad> {
  const entry = join(manifest, '..', 'src', 'index.ts');
  try {
    return { ok: true, entry, exports: (await import(pathToFileURL(entry).href)) as Record<string, unknown> };
  } catch (err: unknown) {
    return { ok: false, detail: `${entry} failed to load: ${String(err)}` };
  }
}
