/**
 * PAW CLI
 *
 * @fileoverview Driving side of hexagon. Compose root of CLI. Route subcommand
 * to handler in `commands/*`, print what formatters return:
 *
 *   paw check                     read decision-input on stdin, allow/deny (exit 0/2)
 *   paw hook --copilot "tool.pre" bridge host hook into loop
 *   paw daemon status|stop        inspect or stop this repo's resident pawd
 *   paw doctor <config.json>      validate config + role bindings
 *   paw swarm doctor|show|run     validate / preview / dispatch swarm plan
 *   paw ui [plan.swarm.mjs]       serve this repository's console
 *   paw trust [--dry-run]         install this machine's PAW CA
 *
 * Handlers here are the process shell (stdin, dynamic import, sockets,
 * `process.exit`). This file and all under `commands/` are excluded from unit
 * coverage and exercised by E2E that spawn this entry. Unknown command or
 * malformed input exits non-zero with a message.
 *
 * @module @paw/cli/infrastructure/main
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegistry, runDoctor, type ModelPort } from '@paw/core';
import { formatDoctor, formatHelp } from '../domain/format.js';
import { runCheck } from './commands/check.js';
import { runConfig } from './commands/config.js';
import { runDaemonCommand } from './commands/daemonCommand.js';
import { runGates } from './commands/gates.js';
import { runInit } from './commands/init.js';
import { runViolations } from './commands/violations.js';
import { runHookCommand } from './commands/hookCommand.js';
import { runPawd } from './commands/pawd.js';
import { runSwarm } from './commands/swarm.js';
import { runTrust } from './commands/trust.js';
import { runUi } from './commands/ui.js';

const KNOWN_CONNECTORS = ['copilot-hooks'];

const NOOP_PORT: ModelPort = {
  complete: async () => ({ content: '', inputTokens: 0, outputTokens: 0 }),
};

/**
 * Load and parse JSON config file.
 *
 * @param {string} path - Path to config.
 * @returns {Promise<Record<string, unknown>>} Parsed config.
 */
async function loadConfig(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

/**
 * CLI entrypoint.
 *
 * @returns {Promise<number>} Exit code for routed command.
 */
async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const print = (lines: string[]): void => {
    process.stdout.write(`${lines.join('\n')}\n`);
  };

  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    print(formatHelp(process.stdout.isTTY === true && process.env.NO_COLOR === undefined));
    return 0;
  }
  if (command === 'check') {
    await runCheck();
    return 0;
  }
  if (command === 'hook') {
    return runHookCommand(rest);
  }
  if (command === '__pawd') {
    return runPawd(resolve(rest[0] ?? process.cwd()));
  }
  if (command === 'daemon') {
    return runDaemonCommand(rest, print);
  }
  if (command === 'gates') {
    return runGates(rest, print);
  }
  if (command === 'init') {
    const mode = rest.includes('--override')
      ? 'override'
      : rest.includes('--merge')
        ? 'merge'
        : 'create';
    return runInit(rest, print, mode);
  }
  if (command === 'sync') {
    return runInit(rest, print, 'merge');
  }
  if (command === 'violations') {
    return runViolations(rest, print);
  }
  if (command === 'config') {
    return runConfig(rest, print);
  }
  if (command === 'doctor') {
    if (rest[0] === undefined) {
      throw new Error('doctor needs a config: paw doctor <config.json>');
    }
    const config = await loadConfig(rest[0]);
    const registry = buildRegistry(config, () => NOOP_PORT);
    const report = runDoctor(config, registry, KNOWN_CONNECTORS);
    print(formatDoctor(report));
    return report.ok ? 0 : 1;
  }
  if (command === 'swarm') {
    const [sub, ...swarmRest] = rest;
    if (sub === 'run' && swarmRest.includes('--ui')) {
      return runUi([...swarmRest.filter((word) => word !== '--ui'), '--run'], print);
    }
    return runSwarm(rest, print);
  }
  if (command === 'ui') {
    return runUi(rest, print);
  }
  if (command === 'tui') {
    // The TUI is its own shell package with a raw-mode stdin loop; spawn it
    // with inherited stdio and carry its exit code.
    const entry = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      'tui',
      'src',
      'infrastructure',
      'main.ts',
    );
    return new Promise<number>((resolveCode) => {
      spawn(process.execPath, ['--import', 'tsx', entry, ...rest], { stdio: 'inherit' }).on(
        'exit',
        (code) => resolveCode(code ?? 0),
      );
    });
  }
  if (command === 'trust') {
    return runTrust(rest, print);
  }
  throw new Error(`unknown command "${command}" — run \`paw help\` for the command list`);
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(
      `error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
