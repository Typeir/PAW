/**
 * PAW Daemon Status Formatting
 *
 * @fileoverview Format what pawd report for `paw daemon status` and `paw daemon
 * stop` (doc 10 §12). Pure formatters over RPC result; round trip live in command
 * shell. Null result mean no daemon answer.
 *
 * @module @paw/cli/domain/daemonStatus
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

const NONE = 'no PAW daemon is running for this repository';

/**
 * Render `daemon.status` result, or lack of daemon.
 *
 * @param {Record<string, unknown> | null} status - Status object, or null when unreachable.
 * @returns {string[]} Lines to print.
 */
export function formatDaemonStatus(status: Record<string, unknown> | null): string[] {
  if (status === null) {
    return [NONE];
  }
  const uptimeSec = Math.round(Number(status.uptimeMs) / 1000);
  return [
    `pawd running · pid ${String(status.pid)}`,
    `  uptime ${uptimeSec}s · protocol ${String(status.protocolVersion)} · ${String(status.health)}`,
    `  root ${String(status.projectRoot)}`,
  ];
}

/**
 * Render `daemon.stop` result, or lack of daemon.
 *
 * @param {unknown} result - Stop result, or null when unreachable.
 * @returns {string[]} Lines to print.
 */
export function formatDaemonStop(result: unknown): string[] {
  return result === null ? [NONE] : ['PAW daemon stopping'];
}
