/**
 * PAW CLI — violations command.
 *
 * @fileoverview `paw violations list` show outstanding violations recorded for
 * this repository; `paw violations prune [<file>]` clear them — one file's, or
 * all when no path given. Thin clients of resident daemon (violations store
 * lives there); both return failure when daemon unreachable. Manual way to clear
 * stale backlog, e.g. violations of a deleted file.
 *
 * @module @paw/cli/infrastructure/commands/violations
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Violation } from '@paw/core';
import { rpcCall, socketPath, tokenPath } from '@paw/daemon';
import { formatPruned, formatViolations } from '../../domain/format.js';

/**
 * Run `violations` subcommand.
 *
 * @param {string[]} rest - Words after `violations`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} 0 when daemon responds, 1 when there is no response.
 */
export async function runViolations(
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
  if (sub === 'list') {
    const result = await rpcCall(endpoint, token, 'violations.list', {});
    print(formatViolations(result as { violations?: Violation[] } | null));
    return result === null ? 1 : 0;
  }
  if (sub === 'prune') {
    const file = rest[1];
    const result = await rpcCall(endpoint, token, 'violations.prune', file ? { file } : {});
    print(formatPruned(result as { cleared?: number } | null, file ?? null));
    return result === null ? 1 : 0;
  }
  throw new Error(`unknown violations subcommand "${sub ?? '(none)'}" — try list or prune [<file>]`);
}
