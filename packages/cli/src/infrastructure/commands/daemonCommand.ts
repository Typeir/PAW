/**
 * PAW CLI — daemon command
 *
 * @fileoverview `paw daemon status|stop`: look at or stop this repo's
 * resident pawd over socket. Both socket clients. Missing daemon report as state.
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
 * Run `daemon` subcommand: inspect, stop, or restart this repo's
 * resident daemon over socket (doc 10 §12). `restart` stop running
 * daemon, wait for socket release, then autostart fresh one.
 *
 * @param {string[]} rest - Words after `daemon`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} 0 when daemon answer (or start), 1 when none.
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
