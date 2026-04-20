#!/usr/bin/env tsx
/**
 * @fileoverview paw — PAW administration CLI entry point.
 *
 * When called with no arguments: prints help text.
 * When called with a subcommand: routes to the matching handler discovered
 * via filesystem-based loading of `./commands/*.ts`. Each command exports a
 * `meta` descriptor and a `run` handler.
 *
 * Uses `import.meta.url` to resolve the commands directory, so the CLI works
 * whether PAW lives in the project tree or in node_modules.
 *
 * @module .github/PAW/cli/paw
 */

import { log } from '@clack/prompts';
import {
    loadCommands,
    resolveCommandsDir,
    type CommandRegistry,
} from './cli-loader';
import { LOGO, printHelp } from './help';

/**
 * CLI entry point. Routes subcommands to their handlers.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const rest = argv.slice(1);

  if (!command) {
    console.log(LOGO);
    printHelp();
    return;
  }

  const commandsDir = resolveCommandsDir(import.meta.url);
  const registry: CommandRegistry = await loadCommands(commandsDir);
  const match = registry.commands.get(command);

  if (match) {
    await match.run(rest);
  } else {
    log.error(`Unknown command: ${command}`);
    printHelp();
  }
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
