/**
 * PAW Daemon Autostart
 *
 * @fileoverview The thundering-herd guard (doc 10 §9a). When a hook finds no
 * daemon, many hooks may arrive at once but only one may spawn it: an exclusive
 * lock file decides the winner, which spawns pawd detached and waits for the
 * socket; everyone else just waits for the same socket, and if it never comes
 * they fail open on this one event. A lock older than the stale ceiling is
 * treated as a crashed starter and cleared. Best-effort: this only tries to bring
 * the daemon up — the caller's RPC then fails open on its own if it is still down.
 *
 * The filesystem, spawn, connect, and clock are injected, so the whole decision
 * tree tests without a process or a real socket.
 *
 * @module @paw/cli/autostart
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

const POLL_MS = 50;
const MAX_WAIT_MS = 3000;
const STALE_MS = 30_000;

/**
 * The effects autostart needs, injected for testing.
 *
 * @interface AutostartSeams
 * @property {(socketPath: string) => Promise<boolean>} probe - Whether the daemon answers a connection.
 * @property {(lockPath: string) => number | null} lockAgeMs - Age of the lock in ms, or null when absent.
 * @property {(lockPath: string) => boolean} acquire - Exclusively create the lock; true when this caller won.
 * @property {(lockPath: string) => void} release - Remove the lock, tolerating its absence.
 * @property {() => void} spawn - Spawn pawd, detached.
 * @property {(ms: number) => Promise<void>} wait - Sleep.
 */
export interface AutostartSeams {
  probe(socketPath: string): Promise<boolean>;
  lockAgeMs(lockPath: string): number | null;
  acquire(lockPath: string): boolean;
  release(lockPath: string): void;
  spawn(): void;
  wait(ms: number): Promise<void>;
}

/**
 * Poll the socket until it answers or the deadline passes.
 *
 * @param {string} socketPath - The endpoint to probe.
 * @param {AutostartSeams} seams - The injected effects.
 * @returns {Promise<void>} Resolves once up, or after the deadline.
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
 * Ensure a daemon is (being) brought up for a project, without racing a herd of
 * hooks into spawning several.
 *
 * @param {string} socketPath - The daemon endpoint.
 * @param {string} lockPath - The autostart lock file.
 * @param {AutostartSeams} seams - The injected effects.
 * @returns {Promise<void>} Best-effort; resolves whether or not the daemon came up.
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
      seams.spawn();
      await waitForSocket(socketPath, seams);
    } finally {
      seams.release(lockPath);
    }
    return;
  }
  await waitForSocket(socketPath, seams);
}
