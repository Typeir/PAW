/**
 * PAW CLI — daemon command
 *
 * @fileoverview `paw daemon status|stop`: inspect or stop this repository's
 * resident pawd over the socket. Both are clients that fail gracefully when no
 * daemon answers — an absent daemon is a state to report, not an error.
 *
 * @module @paw/cli/commands/daemonCommand
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { socketPath, tokenPath } from '@paw/daemon';
import { rpcCall } from '../pawdClient.js';
import { formatDaemonStatus, formatDaemonStop } from '../daemonStatus.js';

/**
 * Run the `daemon` subcommand: inspect or stop this repository's resident daemon
 * over the socket (doc 10 §12).
 *
 * @param {string[]} rest - The words after `daemon`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} 0 when a daemon answered, 1 when none did.
 */
export async function runDaemonCommand(
  rest: string[],
  print: (lines: string[]) => void,
): Promise<number> {
  const sub = rest[0];
  const root = process.cwd();
  const endpoint = socketPath(root, {
    platform: process.platform,
    xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
    tmpdir: tmpdir(),
  });
  const token = tokenPath(resolve(root, '.paw'));
  if (sub === 'status') {
    const status = await rpcCall(endpoint, token, 'daemon.status', {});
    print(formatDaemonStatus(status as Record<string, unknown> | null));
    return status === null ? 1 : 0;
  }
  if (sub === 'stop') {
    const result = await rpcCall(endpoint, token, 'daemon.stop', {});
    print(formatDaemonStop(result));
    return result === null ? 1 : 0;
  }
  throw new Error(`unknown daemon subcommand "${sub ?? '(none)'}" — try status or stop`);
}
