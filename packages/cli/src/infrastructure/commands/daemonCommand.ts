/**
 * PAW CLI — daemon command
 *
 * @fileoverview `paw daemon status|stop`: inspect or stop this repository's
 * resident pawd over the socket. Both are clients that fail gracefully when no
 * daemon answers — an absent daemon is a state to report, not an error.
 *
 * @module @paw/cli/infrastructure/commands/daemonCommand
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { lockPath, rpcCall, socketPath, tokenPath } from '@paw/daemon';
import { ensureDaemon } from '../../application/autostart.js';
import { formatDaemonStatus, formatDaemonStop } from '../../domain/daemonStatus.js';
import { autostartSeams } from './pawd.js';

/**
 * Run the `daemon` subcommand: inspect, stop, or restart this repository's
 * resident daemon over the socket (doc 10 §12). `restart` stops the running
 * daemon, waits for it to release the socket, then autostarts a fresh one — the
 * clean way to pick up new pawd code without hunting the process by hand.
 *
 * @param {string[]} rest - The words after `daemon`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} 0 when a daemon answered (or was started), 1 when none did.
 */
export async function runDaemonCommand(
  rest: string[],
  print: (lines: string[]) => void,
): Promise<number> {
  const sub = rest[0];
  const root = process.cwd();
  const pawDir = resolve(root, '.paw');
  const endpoint = socketPath(root, {
    platform: process.platform,
    xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
    tmpdir: tmpdir(),
  });
  const token = tokenPath(pawDir);
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
  if (sub === 'restart') {
    const seams = autostartSeams(root);
    const stopped = await rpcCall(endpoint, token, 'daemon.stop', {});
    for (let i = 0; i < 60 && (await seams.probe(endpoint)); i += 1) {
      await seams.wait(50);
    }
    await ensureDaemon(endpoint, lockPath(pawDir), seams);
    print([stopped === null ? 'no daemon was running — started a fresh one' : 'PAW daemon restarted']);
    return 0;
  }
  throw new Error(`unknown daemon subcommand "${sub ?? '(none)'}" — try status, stop, or restart`);
}
