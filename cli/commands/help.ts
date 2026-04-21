/**
 * @fileoverview `paw help` — Print CLI help text.
 *
 * @module .github/PAW/cli/commands/help
 */

import type { CommandMeta } from '../cliLoader';
import { LOGO, printHelp } from '../help';

/** Command metadata for the fs-based loader. */
export const meta: CommandMeta = {
  name: 'help',
  aliases: ['-h', '--help'],
  description: 'Show this help message',
};

/**
 * Prints the PAW CLI help text.
 * @param _args - Unused; present for the CliCommand contract.
 */
export function run(_args: string[]): void {
  console.log(LOGO);
  printHelp();
}
