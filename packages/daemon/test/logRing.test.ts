/**
 * Log Ring Tests
 *
 * @fileoverview Mostly about the bound. An unbounded buffer on a daemon that
 * runs for days is a memory leak with a schedule, and the thing most likely to
 * fill it is a source failing in a loop — which is precisely when the daemon has
 * to stay up.
 *
 * @module @paw/daemon/test/logRing
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { LOG_CAPACITY, createLogRing } from '../src/logRing.js';

/**
 * A clock that ticks one second per call, so ordering is visible.
 *
 * @returns {() => string} The clock.
 */
const ticking = (): (() => string) => {
  let second = 0;
  return () => `2026-08-06T12:00:${String(second++).padStart(2, '0')}.000Z`;
};

describe('createLogRing', () => {
  it('holds what it was told, oldest first', () => {
    const ring = createLogRing(ticking());
    ring.append('info', 'started');
    ring.append('warn', 'a source failed');
    ring.append('error', 'and again');

    expect(ring.entries().map((e) => e.message)).toEqual([
      'started',
      'a source failed',
      'and again',
    ]);
    expect(ring.entries().map((e) => e.level)).toEqual(['info', 'warn', 'error']);
    expect(ring.entries()[0].at).toBe('2026-08-06T12:00:00.000Z');
    expect(ring.dropped()).toBe(0);
  });

  it('returns the line it recorded', () => {
    const ring = createLogRing(() => 'then');
    expect(ring.append('warn', 'careful')).toEqual({
      at: 'then',
      level: 'warn',
      message: 'careful',
    });
  });

  it('drops the oldest rather than growing without bound', () => {
    const ring = createLogRing(ticking(), 3);
    for (const message of ['one', 'two', 'three', 'four', 'five']) {
      ring.append('info', message);
    }

    expect(ring.entries().map((e) => e.message)).toEqual(['three', 'four', 'five']);
    // Reported, not hidden: a console can say "and 2 earlier lines" instead of
    // implying it is showing the whole story.
    expect(ring.dropped()).toBe(2);
  });

  it('survives a flood without holding more than its capacity', () => {
    const ring = createLogRing(ticking(), 10);
    for (let line = 0; line < 10_000; line += 1) {
      ring.append('error', `listing source failed ${line}`);
    }

    expect(ring.entries()).toHaveLength(10);
    expect(ring.dropped()).toBe(9_990);
    expect(ring.entries().at(-1)?.message).toBe('listing source failed 9999');
  });

  it('hands out a copy, so a reader cannot edit the daemon’s own record', () => {
    const ring = createLogRing(() => 'then');
    ring.append('info', 'kept');

    (ring.entries() as { length: number }).length = 0;

    expect(ring.entries()).toHaveLength(1);
  });

  it('defaults to a capacity a console can be handed in one frame', () => {
    const ring = createLogRing(ticking());
    for (let line = 0; line < LOG_CAPACITY + 5; line += 1) {
      ring.append('info', `line ${line}`);
    }
    expect(ring.entries()).toHaveLength(LOG_CAPACITY);
    expect(LOG_CAPACITY).toBeLessThanOrEqual(500);
  });

  it('starts empty', () => {
    const ring = createLogRing(() => 'then');
    expect(ring.entries()).toEqual([]);
    expect(ring.dropped()).toBe(0);
  });
});
