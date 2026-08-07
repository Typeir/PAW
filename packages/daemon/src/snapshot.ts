/**
 * PAW Daemon Snapshot Formatting
 *
 * @fileoverview What is left of the snapshot builder now that the snapshot is
 * composed from cached slices rather than rebuilt per request: the display
 * formatting that neither the cache nor the console should own twice.
 *
 * The old `buildSnapshot` — which re-ran the doctor and re-rendered every brief
 * on every read — was deleted rather than kept alongside {@link composeSnapshot}.
 * Two builders for one shape is how a console ends up showing different data
 * depending on which path produced it.
 *
 * @module @paw/daemon/snapshot
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Format an uptime in seconds as a compact human label.
 *
 * @param {number} sec - Seconds of uptime.
 * @returns {string} A label like `2h14m`, `14m03s`, or `07s`.
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
