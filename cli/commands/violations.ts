/**
 * @fileoverview Violation management commands for the PAW CLI.
 *
 * @module .github/PAW/cli/commands/violations
 */

import { log, password } from '@clack/prompts';
import {
  DEFAULT_DB_PATH,
  getUnresolvedViolations,
  openDb,
  resolveAllViolations,
  resolveViolations,
} from '../../paw-db';
import type { CommandMeta } from '../cli-loader';
import { resolveSubcommand } from '../cli-loader';
import { checkPassword, hasPassword } from '../password';

/** Command metadata for the fs-based loader. */
export const meta: CommandMeta = {
  name: 'violations',
  aliases: ['v'],
  description: 'Manage rule violations',
  subcommands: {
    ls: {
      description: 'List unresolved violations',
      aliases: ['list'],
      isDefault: true,
    },
    prune: { description: 'Resolve all stale violations', aliases: ['clear'] },
    resolve: { description: 'Resolve violations for a specific file' },
  },
};

/**
 * List all unresolved violations in the database.
 */
export async function cmdViolationsList(): Promise<void> {
  const db = await openDb(DEFAULT_DB_PATH, { readonly: false });
  try {
    const rows = getUnresolvedViolations(db);

    if (rows.length === 0) {
      log.success('No unresolved violations.');
      return;
    }

    log.info(`${rows.length} unresolved violation(s) in database:`);
    for (const v of rows) {
      log.message(
        `  #${v.id} ${v.file_path}\n       ${v.rule} (${v.hook_event}, ${v.created_at})`,
      );
    }
  } finally {
    db.close();
  }
}

/**
 * Prompt for and verify the PAW admin password.
 *
 * @returns True if the password was verified or none is set, false otherwise.
 */
async function requirePassword(): Promise<boolean> {
  if (!hasPassword()) {
    return true;
  }
  const pw = await password({ message: 'Enter PAW admin password:' });
  if (typeof pw !== 'string') {
    log.info('Cancelled.');
    return false;
  }
  if (!checkPassword(pw)) {
    log.error('Incorrect password.');
    return false;
  }
  return true;
}

/**
 * Resolve all stale violations in the database.
 */
export async function cmdViolationsPrune(): Promise<void> {
  if (!(await requirePassword())) return;

  const db = await openDb();
  try {
    const count = resolveAllViolations(db);
    log.success(`Resolved ${count} violation(s) in database.`);
  } finally {
    db.close();
  }
}

/**
 * Resolve violations for a specific file path.
 *
 * @param filePath - Absolute or relative file path to resolve
 */
export async function cmdViolationsResolve(filePath?: string): Promise<void> {
  if (!filePath) {
    log.error('Usage: paw violations resolve <file-path>');
    return;
  }

  if (!(await requirePassword())) return;

  const resolved = filePath.startsWith('/')
    ? filePath
    : `${process.cwd()}/${filePath}`.replace(/\\/g, '/');

  const db = await openDb();
  try {
    const count = resolveViolations(db, resolved);
    log.success(`Resolved ${count} violation(s) for ${resolved}`);
  } finally {
    db.close();
  }
}

/**
 * Dispatch subcommands for `paw violations`.
 * @param args - Remaining argv after the command name.
 */
export async function run(args: string[]): Promise<void> {
  const sub = resolveSubcommand(meta, args[0]);

  switch (sub) {
    case 'ls':
      cmdViolationsList();
      break;
    case 'prune':
      await cmdViolationsPrune();
      break;
    case 'resolve':
      await cmdViolationsResolve(args[1]);
      break;
    default:
      log.error(`Unknown violations subcommand: ${args[0] ?? '(none)'}`);
  }
}
