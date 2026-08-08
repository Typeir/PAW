/**
 * PAW Daemon Process Ownership
 *
 * @fileoverview Narrows the host process table to the processes PAW actually owns
 * — the daemon itself and the swarm workers descended from it — and nothing else.
 * Exposing the whole machine's process list over the control API, even on
 * loopback, discloses every piece of software running on the host to any local
 * reader; the console only needs its own herd. This computes the daemon's process
 * subtree by walking the parent→child relation, and it is pure and exhaustively
 * tested so the filter can never silently widen.
 *
 * @module @paw/daemon/process
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { HostProcess } from '@paw/core';

/**
 * Collect the process subtree rooted at a pid: that process (when present) plus
 * every descendant, following `ppid`. Unrelated processes are excluded, and a
 * `ppid` cycle terminates rather than looping.
 *
 * @param {readonly HostProcess[]} all - The full host process table.
 * @param {number} rootPid - The pid to root the subtree at (the daemon's own pid).
 * @returns {HostProcess[]} The rooted subtree, in breadth-first order.
 */
export function collectSubtree(
  all: readonly HostProcess[],
  rootPid: number,
): HostProcess[] {
  const byParent = new Map<number, HostProcess[]>();
  for (const proc of all) {
    const siblings = byParent.get(proc.ppid) ?? [];
    siblings.push(proc);
    byParent.set(proc.ppid, siblings);
  }

  const root = all.find((p) => p.pid === rootPid);
  const out: HostProcess[] = root ? [root] : [];
  const seen = new Set<number>([rootPid]);
  const queue: number[] = [rootPid];

  while (queue.length > 0) {
    const pid = queue.shift() as number;
    for (const child of byParent.get(pid) ?? []) {
      if (!seen.has(child.pid)) {
        seen.add(child.pid);
        out.push(child);
        queue.push(child.pid);
      }
    }
  }
  return out;
}
