/**
 * @fileoverview PAW state command — enable or disable PAW enforcement globally.
 *
 * When PAW is disabled, all hooks exit immediately without running gates,
 * recording violations, or blocking tool use. Useful for running weaker agents
 * on drafting or organisational tasks that should not be blocked by enforcement.
 *
 * Usage:
 *   paw state          — print current state
 *   paw state enable   — re-enable PAW enforcement
 *   paw state disable  — disable PAW enforcement
 *
 * @module .github/PAW/cli/commands/state
 */

import { log, password } from '@clack/prompts';
import {
    DEFAULT_DB_PATH,
    getPawConfig,
    openDb,
    openDbReadonly,
    setPawConfig,
} from '../../paw-db';
import type { CommandMeta } from '../cli-loader';
import { checkPassword, hasPassword } from '../password';

/** Command metadata for the fs-based loader. */
export const meta: CommandMeta = {
  name: 'state',
  aliases: [],
  description: 'Enable or disable PAW enforcement (paw state [enable|disable])',
};

/**
 * Prompt for and verify the PAW admin password.
 * If no password has been set, defaults to allow (fail open).
 *
 * @returns True if the password was verified or none is set, false otherwise
 */
async function requirePassword(): Promise<boolean> {
  if (!hasPassword()) {
    log.warn(
      'No PAW admin password set. Run `npm run paw:set-password` to lock destructive commands.',
    );
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
 * Read the current paw_state from the database, defaulting to 'enabled'.
 *
 * @returns Current PAW state string
 */
async function readState(): Promise<string> {
  try {
    const db = await openDbReadonly(DEFAULT_DB_PATH);
    if (!db) return 'enabled';
    try {
      return getPawConfig(db, 'paw_state') ?? 'enabled';
    } finally {
      db.close();
    }
  } catch {
    return 'enabled';
  }
}

/**
 * Enable or disable PAW, or print the current state.
 *
 * @param args - CLI arguments; first element is 'enable', 'disable', or absent
 */
export async function run(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand) {
    const current = await readState();
    const icon = current === 'disabled' ? '🔴' : '🟢';
    log.info(`PAW enforcement is currently: ${icon} ${current.toUpperCase()}`);
    return;
  }

  if (subcommand !== 'enable' && subcommand !== 'disable') {
    log.error(`Unknown subcommand: ${subcommand}. Use 'enable' or 'disable'.`);
    process.exit(1);
  }

  if (subcommand === 'disable') {
    if (!(await requirePassword())) return;
  }

  try {
    const db = await openDb(DEFAULT_DB_PATH);
    try {
      setPawConfig(
        db,
        'paw_state',
        subcommand === 'disable' ? 'disabled' : 'enabled',
      );
    } finally {
      db.close();
    }
  } catch (err) {
    log.error(
      `Failed to update PAW state: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  if (subcommand === 'disable') {
    log.warn(
      '🔴 PAW enforcement DISABLED — hooks will pass through without running gates.',
    );
    log.message('  Run `npm run paw:enable` to restore enforcement.');
  } else {
    log.success(
      '🟢 PAW enforcement ENABLED — hooks will enforce quality gates.',
    );
  }
}
