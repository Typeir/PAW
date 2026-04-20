/**
 * @fileoverview Status command for the PAW CLI.
 *
 * @module .github/PAW/cli/commands/status
 */

import { log } from '@clack/prompts';
import { existsSync, readFileSync } from 'node:fs';
import {
    DEFAULT_DB_PATH,
    getUnresolvedViolations,
    openDbReadonly,
} from '../../paw-db';
import { HOOKS_JSON_PATH, PAW_CONFIG_PATH, PAW_DIR } from '../../paw-paths';
import type { CommandMeta } from '../cli-loader';

/** Command metadata for the fs-based loader. */
export const meta: CommandMeta = {
  name: 'status',
  aliases: ['st'],
  description: 'Show PAW surface config and hook registration',
};

/**
 * Show PAW surface config, hook registration, and system state.
 * @param _args - Unused; present for the CliCommand contract.
 */
export async function run(_args: string[]): Promise<void> {
  log.info('PAW Status');

  log.message(
    `  .paw/ directory: ${existsSync(PAW_DIR) ? '✅ exists' : '❌ missing'}`,
  );
  log.message(
    `  Database: ${existsSync(DEFAULT_DB_PATH) ? '✅ exists' : '❌ missing'}`,
  );
  let violationCount = 0;
  try {
    const db = await openDbReadonly(DEFAULT_DB_PATH);
    if (db) {
      try {
        violationCount = getUnresolvedViolations(db).length;
      } finally {
        db.close();
      }
    }
  } catch {
    /* DB read failure — treat as no violations */
  }
  log.message(
    `  Violations: ${violationCount > 0 ? `⚠️  ${violationCount} unresolved` : '✅ clean'}`,
  );

  if (existsSync(PAW_CONFIG_PATH)) {
    try {
      const config = JSON.parse(readFileSync(PAW_CONFIG_PATH, 'utf-8')) as {
        surface?: string;
      };
      log.message(`  Surface: ${config.surface ?? '(not set)'}`);
    } catch {
      log.message('  Surface: ❌ failed to parse config.json');
    }
  } else {
    log.message('  Surface: (no config.json — will use default)');
  }

  if (existsSync(HOOKS_JSON_PATH)) {
    try {
      const hooks = JSON.parse(readFileSync(HOOKS_JSON_PATH, 'utf-8')) as {
        hooks?: Record<string, unknown[]>;
      };
      const events = Object.keys(hooks.hooks ?? {});
      const totalHooks = Object.values(hooks.hooks ?? {}).reduce(
        (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
        0,
      );
      log.message(
        `  hooks.json: ${totalHooks} hook(s) across ${events.length} event(s)`,
      );
      for (const evt of events) {
        const count = (hooks.hooks?.[evt] as unknown[])?.length ?? 0;
        log.message(`    ${evt}: ${count} handler(s)`);
      }
    } catch {
      log.message('  hooks.json: ❌ failed to parse');
    }
  } else {
    log.message('  hooks.json: ❌ missing — run `paw sync`');
  }
}
