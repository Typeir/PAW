/**
 * @fileoverview `paw set-password` command. Sets or updates the password
 * required for destructive violation management operations.
 *
 * @module .github/PAW/cli/commands/set-password
 */

import { log, password } from '@clack/prompts';
import type { CommandMeta } from '../cliLoader';
import { hasPassword, savePassword } from '../password';

/** Command metadata for the fs-based loader. */
export const meta: CommandMeta = {
  name: 'set-password',
  aliases: ['passwd'],
  description: 'Set or update the PAW admin password',
};

/**
 * Handler for `paw set-password`.
 */
export async function run(): Promise<void> {
  if (hasPassword()) {
    log.warn('A password is already set. This will overwrite it.');
  }

  const pw = await password({
    message: 'Enter new PAW admin password:',
    validate: (value) => {
      if (!value || value.length < 4) {
        return 'Password must be at least 4 characters.';
      }
    },
  });

  if (typeof pw !== 'string') {
    log.info('Cancelled.');
    return;
  }

  const confirm = await password({
    message: 'Confirm password:',
  });

  if (typeof confirm !== 'string') {
    log.info('Cancelled.');
    return;
  }

  if (pw !== confirm) {
    log.error('Passwords do not match.');
    return;
  }

  savePassword(pw);
  log.success('Password saved to .paw/.pawsecret');
}
