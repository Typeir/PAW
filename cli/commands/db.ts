/**
 * @fileoverview Database administration commands for the PAW CLI.
 *
 * @module .github/PAW/cli/commands/db
 */

import { log } from '@clack/prompts';
import { DEFAULT_DB_PATH, ensureSchema, openDb } from '../../paw-db';
import type { CommandMeta } from '../cli-loader';
import { resolveSubcommand } from '../cli-loader';

/** Command metadata for the fs-based loader. */
export const meta: CommandMeta = {
  name: 'db',
  description: 'Database administration',
  subcommands: {
    stats: { description: 'Show table row counts', isDefault: true },
    reset: { description: 'Drop and recreate all tables' },
  },
};

/**
 * Table names tracked in the PAW schema.
 */
const TABLES = [
  'decisions',
  'patterns',
  'agent_memory',
  'task_index',
  'violations',
  'memory_types',
] as const;

/**
 * Print row counts for all PAW database tables.
 */
export function cmdDbStats(): void {
  const db = openDb(DEFAULT_DB_PATH, { readonly: false });
  try {
    log.info('PAW Database Stats:');
    for (const table of TABLES) {
      try {
        const row = db
          .prepare(`SELECT COUNT(*) AS cnt FROM ${table}`)
          .get() as { cnt: number };
        log.message(`  ${table}: ${row.cnt} rows`);
      } catch {
        log.message(`  ${table}: (not found)`);
      }
    }
  } finally {
    db.close();
  }
}

/**
 * Drop all tables and recreate the schema from scratch.
 */
export function cmdDbReset(): void {
  const db = openDb();
  try {
    db.pragma('foreign_keys = OFF');
    for (const table of [...TABLES].reverse()) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
    db.pragma('foreign_keys = ON');
    ensureSchema(db);
    log.success('Database reset — all tables recreated.');
  } finally {
    db.close();
  }
}

/**
 * Dispatch subcommands for `paw db`.
 * @param args - Remaining argv after the command name.
 */
export function run(args: string[]): void {
  const sub = resolveSubcommand(meta, args[0]);

  switch (sub) {
    case 'stats':
      cmdDbStats();
      break;
    case 'reset':
      cmdDbReset();
      break;
    default:
      log.error(`Unknown db subcommand: ${args[0] ?? '(none)'}`);
  }
}
