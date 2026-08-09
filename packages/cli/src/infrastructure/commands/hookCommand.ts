/**
 * PAW CLI — hook command
 *
 * @fileoverview `paw hook --copilot "tool.pre"`: a thin client of the resident
 * daemon. It names the host (a flag) and the event (its value), autostarts pawd
 * if none is up, and hands the round trip to `runHook`, which asks pawd to decide
 * and writes the answer — or, with no daemon reachable, the host's do-nothing
 * output. No store, no gates, no per-hook state: the daemon owns all of it.
 *
 * @module @paw/cli/infrastructure/commands/hookCommand
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { lockPath, socketPath, tokenPath } from '@paw/daemon';
import { ensureDaemon } from '../../application/autostart.js';
import { runHook } from '../../application/hook.js';
import { parseArgs } from '../../domain/context.js';
import { readStdin } from '../stdin.js';
import { autostartSeams } from './pawd.js';

const HOST_FLAGS = ['copilot'];

/**
 * Run the `hook` subcommand: a thin client of the resident daemon.
 *
 * @param {string[]} rest - The words after `hook`.
 * @returns {Promise<number>} The exit code (0; the decision rides in the JSON).
 */
export async function runHookCommand(rest: string[]): Promise<number> {
  const args = parseArgs(rest, HOST_FLAGS);
  const host = HOST_FLAGS.find((h) => args.values.get(h) !== undefined);
  if (host === undefined) {
    throw new Error('paw hook needs a host and event: paw hook --copilot "tool.pre"');
  }
  const event = args.values.get(host) as string;
  const root = process.cwd();
  const pawDir = resolve(root, '.paw');
  const endpoint = socketPath(root, {
    platform: process.platform,
    xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
    tmpdir: tmpdir(),
  });
  await ensureDaemon(endpoint, lockPath(pawDir), autostartSeams(root));
  return runHook({
    host,
    event,
    socketPath: endpoint,
    tokenPath: tokenPath(pawDir),
    io: { readStdin, writeStdout: (text) => process.stdout.write(text) },
  });
}
