/**
 * PAW CLI
 *
 * @fileoverview The driving side of the hexagon and the CLI's composition root.
 * Routes a subcommand to its handler in `commands/*` and prints what the
 * formatters return:
 *
 *   paw check                     read a decision-input on stdin, allow/deny (exit 0/2)
 *   paw hook --copilot "tool.pre" bridge a host hook into the loop
 *   paw daemon status|stop        inspect or stop this repo's resident pawd
 *   paw doctor <config.json>      validate config + role bindings
 *   paw swarm doctor|show|run     validate / preview / dispatch a swarm plan
 *   paw ui [plan.swarm.mjs]       serve this repository's console
 *   paw trust [--dry-run]         install this machine's PAW CA
 *
 * Holds no rules. Each handler is process-shell (stdin, dynamic import, sockets,
 * `process.exit`), so this file and everything under `commands/` are excluded
 * from unit coverage and exercised by the E2E, which spawns this entry. Fails
 * loud: an unknown command or a malformed input exits non-zero with a message.
 *
 * @module @paw/cli/main
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { readFile } from 'node:fs/promises';
import { buildRegistry, runDoctor, type ModelPort } from '@paw/core';
import { formatDoctor } from './format.js';
import { runCheck } from './commands/check.js';
import { runDaemonCommand } from './commands/daemonCommand.js';
import { runGates } from './commands/gates.js';
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
 * Load and parse a JSON config file.
 *
 * @param {string} path - Path to the config.
 * @returns {Promise<Record<string, unknown>>} The parsed config.
 */
async function loadConfig(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

/**
 * CLI entrypoint.
 *
 * @returns {Promise<number>} The exit code for the routed command.
 */
async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const print = (lines: string[]): void => {
    process.stdout.write(`${lines.join('\n')}\n`);
  };

  if (command === 'check') {
    await runCheck();
    return 0;
  }
  if (command === 'hook') {
    return runHookCommand(rest);
  }
  if (command === '__pawd') {
    return runPawd(rest[0] ?? process.cwd());
  }
  if (command === 'daemon') {
    return runDaemonCommand(rest, print);
  }
  if (command === 'gates') {
    return runGates(rest, print);
  }
  if (command === 'doctor') {
    const config = await loadConfig(rest[0]);
    const registry = buildRegistry(config, () => NOOP_PORT);
    const report = runDoctor(config, registry, KNOWN_CONNECTORS);
    print(formatDoctor(report));
    return report.ok ? 0 : 1;
  }
  if (command === 'swarm') {
    return runSwarm(rest, print);
  }
  if (command === 'ui') {
    return runUi(rest, print);
  }
  if (command === 'trust') {
    return runTrust(rest, print);
  }
  throw new Error(`unknown command "${command ?? '(none)'}"`);
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(
      `error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
