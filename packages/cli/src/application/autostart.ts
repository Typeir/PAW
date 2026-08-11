/**
 * PAW daemon autostart.
 *
 * @fileoverview Guarantees at most one daemon spawn per project (doc 10 §9a).
 * When daemon is absent, hooks race for the exclusive lock file; the winner
 * spawns pawd detached and waits for the socket, all others wait on the same
 * socket and fail open if it never appears. A lock older than the stale
 * ceiling counts as a crashed starter and is released. Best-effort: bring
 * daemon up; caller RPC fails open on its own if still down.
 *
 * Filesystem, spawn, connect, clock all injected. Decision tree test without
 * process or real socket.
 *
 * @module @paw/cli/application/autostart
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

const POLL_MS = 50;
const MAX_WAIT_MS = 3000;
const STALE_MS = 30_000;

/**
 * Effects autostart need, injected for testing.
 *
 * @interface AutostartSeams
 * @property {(socketPath: string) => Promise<boolean>} probe - Whether daemon answer connection.
 * @property {(lockPath: string) => number | null} lockAgeMs - Age of lock in ms, or null when absent.
 * @property {(lockPath: string) => boolean} acquire - Exclusively create lock; true when this caller win.
 * @property {(lockPath: string) => void} release - Remove lock, tolerate its absence.
 * @property {() => void | Promise<void>} spawn - Spawn pawd off caller's tree; may resolve once spawn handed off.
 * @property {(ms: number) => Promise<void>} wait - Sleep.
 */
export interface AutostartSeams {
  probe(socketPath: string): Promise<boolean>;
  lockAgeMs(lockPath: string): number | null;
  acquire(lockPath: string): boolean;
  release(lockPath: string): void;
  spawn(): void | Promise<void>;
  wait(ms: number): Promise<void>;
}

/**
 * Poll socket until it answer or deadline pass.
 *
 * @param {string} socketPath - The endpoint to probe.
 * @param {AutostartSeams} seams - The injected effects.
 * @returns {Promise<void>} Resolve once up, or after deadline.
 */
async function waitForSocket(socketPath: string, seams: AutostartSeams): Promise<void> {
  const tries = Math.floor(MAX_WAIT_MS / POLL_MS);
  for (let i = 0; i < tries; i += 1) {
    await seams.wait(POLL_MS);
    if (await seams.probe(socketPath)) {
      return;
    }
  }
}

/**
 * Ensure daemon comes up for project; concurrent hooks spawn at most one daemon.
 *
 * @param {string} socketPath - The daemon endpoint.
 * @param {string} lockPath - The autostart lock file.
 * @param {AutostartSeams} seams - The injected effects.
 * @returns {Promise<void>} Best-effort; resolve whether or not daemon came up.
 */
export async function ensureDaemon(
  socketPath: string,
  lockPath: string,
  seams: AutostartSeams,
): Promise<void> {
  if (await seams.probe(socketPath)) {
    return;
  }
  const age = seams.lockAgeMs(lockPath);
  if (age !== null && age > STALE_MS) {
    seams.release(lockPath);
  }
  if (seams.acquire(lockPath)) {
    try {
      await seams.spawn();
      await waitForSocket(socketPath, seams);
    } finally {
      seams.release(lockPath);
    }
    return;
  }
  await waitForSocket(socketPath, seams);
}
