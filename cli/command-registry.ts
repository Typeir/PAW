/**
 * @fileoverview Static command registry for the bundled PAW CLI.
 *
 * In development (tsx), the CLI uses filesystem-based command discovery.
 * In the bundled build, dynamic import() doesn't work, so this module
 * provides a static registry that pre-imports all commands.
 *
 * @module .github/PAW/cli/command-registry
 */

import type { CliCommand, CommandRegistry } from './cli-loader';

import * as dbCmd from './commands/db';
import * as gatesCmd from './commands/gates';
import * as helpCmd from './commands/help';
import * as setPasswordCmd from './commands/set-password';
import * as stateCmd from './commands/state';
import * as statusCmd from './commands/status';
import * as syncCmd from './commands/sync';
import * as violationsCmd from './commands/violations';

const ALL_COMMANDS: CliCommand[] = [
  dbCmd as CliCommand,
  gatesCmd as CliCommand,
  helpCmd as CliCommand,
  setPasswordCmd as CliCommand,
  stateCmd as CliCommand,
  statusCmd as CliCommand,
  syncCmd as CliCommand,
  violationsCmd as CliCommand,
];

/**
 * Build a static command registry from the pre-imported command modules.
 *
 * @returns CommandRegistry with all PAW CLI commands
 */
export function buildStaticRegistry(): CommandRegistry {
  const commands = new Map<string, CliCommand>();

  for (const cmd of ALL_COMMANDS) {
    commands.set(cmd.meta.name, cmd);
    if (cmd.meta.aliases) {
      for (const alias of cmd.meta.aliases) {
        commands.set(alias, cmd);
      }
    }
  }

  return { commands, all: ALL_COMMANDS };
}
