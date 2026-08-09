/**
 * PAW CLI — violations command
 *
 * @fileoverview `paw violations list` shows the outstanding violations pawd is
 * holding for this repository; `paw violations prune [<file>]` resolves them — a
 * single file's, or all of them when no path is given. Thin clients of the
 * resident daemon (the store lives there), so both fail open when no daemon
 * answers. The manual escape hatch for a backlog that survived, e.g. a file that
 * was deleted rather than fixed.
 *
 * @module @paw/cli/commands/violations
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Violation } from '@paw/core';
import { rpcCall, socketPath, tokenPath } from '@paw/daemon';
import { formatPruned, formatViolations } from '../format.js';

/**
 * Run the `violations` subcommand.
 *
 * @param {string[]} rest - The words after `violations`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} 0 when the daemon answered, 1 when none did.
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
