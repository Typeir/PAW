/**
 * PAW Daemon Log Ring
 *
 * @fileoverview What the daemon has said recently, bounded.
 *
 * A console that opens ten minutes into a run wants to know what happened
 * before it arrived, and the daemon's stderr is not somewhere a browser can
 * read. So the same lines go into a fixed-size ring: the newest N, and the older
 * ones dropped rather than accumulated.
 *
 * **Bounded is the whole point.** An unbounded buffer on a long-running daemon
 * is a memory leak with a schedule, and the thing most likely to fill it is a
 * source failing in a loop — exactly the situation where the daemon must stay
 * up. Dropping the oldest line is the honest trade, and `dropped` reports how
 * many were lost so a console can say "…and 1,240 earlier lines" rather than
 * implying it has the whole story.
 *
 * Pure over injected time, so ordering and eviction are unit-tested rather than
 * observed.
 *
 * @module @paw/daemon/logRing
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { LogEntry } from '@paw/core';

/**
 * How many lines the ring holds. Enough to explain a failing source or a run
 * that went wrong, small enough that a console can be handed the lot in one
 * frame without thinking about it.
 */
export const LOG_CAPACITY = 200;

/**
 * A bounded record of what the daemon has said.
 *
 * @interface LogRing
 * @property {(level: LogEntry['level'], message: string) => LogEntry} append - Record a line and return it.
 * @property {() => readonly LogEntry[]} entries - The lines held, oldest first.
 * @property {() => number} dropped - How many lines were evicted, ever.
 */
export interface LogRing {
  append(level: LogEntry['level'], message: string): LogEntry;
  entries(): readonly LogEntry[];
  dropped(): number;
}

/**
 * Build a log ring.
 *
 * @param {() => string} now - An ISO timestamp for each line.
 * @param {number} [capacity] - How many lines to hold.
 * @returns {LogRing} The ring.
 */
export function createLogRing(now: () => string, capacity: number = LOG_CAPACITY): LogRing {
  const held: LogEntry[] = [];
  let evicted = 0;

  return {
    append: (level: LogEntry['level'], message: string): LogEntry => {
      const entry: LogEntry = { at: now(), level, message };
      held.push(entry);
      while (held.length > capacity) {
        held.shift();
        evicted += 1;
      }
      return entry;
    },
    entries: (): readonly LogEntry[] => [...held],
    dropped: (): number => evicted,
  };
}
