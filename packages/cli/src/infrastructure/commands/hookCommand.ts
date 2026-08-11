/**
 * PAW CLI — hook command
 *
 * @fileoverview `paw hook --copilot "tool.pre"`: client of resident daemon.
 * Name host (a flag) and event (its value), autostart pawd if none up, then
 * pass both to `runHook`. `runHook` sends the event to pawd and writes pawd's
 * reply — or, with no daemon reachable, writes do-nothing output. No store, no
 * gates, no per-hook state; daemon holds all state.
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
 * Run `hook` subcommand: client of resident daemon.
 *
 * @param {string[]} rest - Words after `hook`.
 * @returns {Promise<number>} Exit code (0; decision written to stdout as JSON).
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
