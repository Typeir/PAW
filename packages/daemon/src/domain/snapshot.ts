/**
 * PAW Daemon Snapshot Formatting
 *
 * @fileoverview Display formatting for snapshot, shared by cache and
 * console. Snapshot composed from cached slices by
 * {@link composeSnapshot}; old `buildSnapshot`, which re-ran doctor
 * and re-rendered every brief per read, removed.
 *
 * @module @paw/daemon/snapshot
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Format uptime in seconds as compact human label.
 *
 * @param {number} sec - Seconds of uptime.
 * @returns {string} Label like `2h14m`, `14m03s`, or `07s`.
 */
export function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}h${String(m).padStart(2, '0')}m`;
  }
  if (m > 0) {
    return `${m}m${String(s).padStart(2, '0')}s`;
  }
  return `${String(s).padStart(2, '0')}s`;
}
