/**
 * PAW Daemon Status Formatting
 *
 * @fileoverview How `paw daemon status` and `paw daemon stop` render what pawd
 * reports (doc 10 §12). The RPC round trip lives in the command shell; these are
 * the pure formatters over its result — a null result means no daemon answered,
 * which is a normal state to report, not an error to throw.
 *
 * @module @paw/cli/domain/daemonStatus
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

const NONE = 'no PAW daemon is running for this repository';

/**
 * Render a `daemon.status` result, or the absence of a daemon.
 *
 * @param {Record<string, unknown> | null} status - The status object, or null when unreachable.
 * @returns {string[]} The lines to print.
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
 * Render a `daemon.stop` result, or the absence of a daemon.
 *
 * @param {unknown} result - The stop result, or null when unreachable.
 * @returns {string[]} The lines to print.
 */
export function formatDaemonStop(result: unknown): string[] {
  return result === null ? [NONE] : ['PAW daemon stopping'];
}
