/**
 * @fileoverview Unit test for the daemon autostart guard. Drive by injected
 * seams: already-up returns at once; lock winner spawns and waits until the
 * socket comes up or the deadline elapses; loser only waits; stale lock is
 * cleared first; fresh lock is left alone.
 * Cover `autostart.ts` to 100% without process or socket.
 *
 * @module @paw/cli/test/unit/autostart
 */

import { describe, expect, it } from 'vitest';
import { ensureDaemon, type AutostartSeams } from '../../src/application/autostart.js';

/**
 * Build seams. Probe follow scripted sequence (last value repeat), fixed lock
 * age and lock-winner outcome, count each effect.
 *
 * @param cfg - probe sequence, lock age, and whether acquire win.
 */
function mock(cfg: { probe?: boolean[]; age?: number | null; won?: boolean }) {
  const probes = cfg.probe ?? [true];
  let i = 0;
  const calls = { spawn: 0, release: 0, acquire: 0, waits: 0 };
  const seams: AutostartSeams = {
    async probe() {
      const r = probes[Math.min(i, probes.length - 1)];
      i += 1;
      return r;
    },
    lockAgeMs: () => (cfg.age === undefined ? null : cfg.age),
    acquire: () => {
      calls.acquire += 1;
      return cfg.won ?? true;
    },
    release: () => {
      calls.release += 1;
    },
    spawn: () => {
      calls.spawn += 1;
    },
    async wait() {
      calls.waits += 1;
    },
  };
  return { seams, calls };
}

describe('ensureDaemon', () => {
  it('does nothing when the daemon already answers', async () => {
    const { seams, calls } = mock({ probe: [true] });
    await ensureDaemon('sock', 'lock', seams);
    expect(calls).toMatchObject({ acquire: 0, spawn: 0, waits: 0 });
  });

  it('the lock winner spawns and returns once the socket comes up', async () => {
    const { seams, calls } = mock({ probe: [false, true], won: true });
    await ensureDaemon('sock', 'lock', seams);
    expect(calls).toMatchObject({ acquire: 1, spawn: 1, release: 1, waits: 1 });
  });

  it('the lock winner gives up after the deadline, still releasing', async () => {
    const { seams, calls } = mock({ probe: [false], won: true });
    await ensureDaemon('sock', 'lock', seams);
    expect(calls.spawn).toBe(1);
    expect(calls.release).toBe(1);
    expect(calls.waits).toBe(60);
  });

  it('a loser only waits for the winner, and does not spawn', async () => {
    const { seams, calls } = mock({ probe: [false, true], won: false });
    await ensureDaemon('sock', 'lock', seams);
    expect(calls).toMatchObject({ acquire: 1, spawn: 0, waits: 1 });
  });

  it('clears a stale lock before acquiring', async () => {
    const { seams, calls } = mock({ probe: [false, true], age: 40_000, won: true });
    await ensureDaemon('sock', 'lock', seams);
    expect(calls.release).toBe(2);
    expect(calls.spawn).toBe(1);
  });

  it('leaves a fresh lock alone', async () => {
    const { seams, calls } = mock({ probe: [false, true], age: 5_000, won: false });
    await ensureDaemon('sock', 'lock', seams);
    expect(calls).toMatchObject({ acquire: 1, spawn: 0, release: 0 });
  });
});
