/**
 * PAW Plugin Loader
 *
 * @fileoverview Discovers and executes plugins from `.paw/plugins/{hookName}/`.
 * Each `.ts` file in the folder must export a `plugin` constant (or default export)
 * satisfying the {@link PawPlugin} interface.
 *
 * Decision compound: if ANY plugin returns `block: true`, the aggregate blocks.
 * Errors in individual plugins are caught and logged — they never crash the host hook.
 *
 * @module .github/PAW/plugin-loader
 * @author Typeir
 * @version 1.0.0
 * @since 4.0.0
 */

import type BetterSqlite3 from 'better-sqlite3';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PLUGINS_DIR } from './paw-paths';
import type { AggregatePluginResult, PawPlugin } from './plugin-types';

/**
 * Discover plugin files for a given hook name.
 *
 * @param hookName - Hook name matching a subfolder in .paw/plugins/ (e.g. 'session-end')
 * @returns Array of absolute paths to plugin .ts files
 */
function discoverPlugins(hookName: string): string[] {
  const dir = path.join(PLUGINS_DIR, hookName);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Import a single plugin file and extract the PawPlugin export.
 *
 * @param filePath - Absolute path to the plugin .ts file
 * @returns The plugin instance or null if the file doesn't export a valid plugin
 */
async function importPlugin(filePath: string): Promise<PawPlugin | null> {
  try {
    const mod = await import(filePath);
    const candidate = mod.plugin ?? mod.default;

    if (
      candidate &&
      typeof candidate.name === 'string' &&
      typeof candidate.run === 'function'
    ) {
      return candidate as PawPlugin;
    }

    process.stderr.write(
      `PAW plugin-loader: ${path.basename(filePath)} does not export a valid plugin\n`,
    );
    return null;
  } catch (err: unknown) {
    process.stderr.write(
      `PAW plugin-loader: failed to import ${path.basename(filePath)}: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return null;
  }
}

/**
 * Run all plugins for a hook event and return the compounded result.
 *
 * @param hookName - Hook name (e.g. 'pre-tool-use', 'post-tool-use', 'session-end')
 * @param hookInput - The raw hook input payload
 * @param db - SQLite database handle (may be null if the hook doesn't use a DB)
 * @returns Aggregate result — block is true if ANY plugin blocked
 */
export async function runPlugins(
  hookName: string,
  hookInput: Record<string, unknown>,
  db: BetterSqlite3.Database | null,
): Promise<AggregatePluginResult> {
  const files = discoverPlugins(hookName);

  if (files.length === 0) {
    return { block: false, messages: [] };
  }

  const messages: string[] = [];
  let block = false;

  for (const filePath of files) {
    const plugin = await importPlugin(filePath);
    if (!plugin) continue;

    try {
      const result = await plugin.run(hookInput, db);

      if (result.block) {
        block = true;
        if (result.message) {
          messages.push(`[${plugin.name}] ${result.message}`);
        }
      }
    } catch (err: unknown) {
      process.stderr.write(
        `PAW plugin ${plugin.name}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  return { block, messages };
}
