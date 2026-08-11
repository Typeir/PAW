/**
 * PAW Daemon Log Ring
 *
 * @fileoverview Bounded record of recent daemon log lines. Lines go into fixed-size
 * ring, hold newest N; older lines drop. Ring gives browser console recent log lines
 * daemon stderr does not expose. `dropped` reports how many lines lost. Creation takes
 * an injected time function; ordering and eviction are unit-tested.
 *
 * @module @paw/daemon/logRing
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { LogEntry } from '@paw/core';

/**
 * How many lines ring holds. Enough to cover a failing source or run that went
 * wrong, small enough that console receives the whole set in one frame.
 */
export const LOG_CAPACITY = 200;

/**
 * Bounded record of what daemon say.
 *
 * @interface LogRing
 * @property {(level: LogEntry['level'], message: string) => LogEntry} append - Record line, return it.
 * @property {() => readonly LogEntry[]} entries - Lines held, oldest first.
 * @property {() => number} dropped - How many lines evicted, ever.
 */
export interface LogRing {
  append(level: LogEntry['level'], message: string): LogEntry;
  entries(): readonly LogEntry[];
  dropped(): number;
}

/**
 * Build log ring.
 *
 * @param {() => string} now - ISO timestamp for each line.
 * @param {number} [capacity] - How many lines to hold.
 * @returns {LogRing} Ring.
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
