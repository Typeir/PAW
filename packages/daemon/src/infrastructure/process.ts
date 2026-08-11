/**
 * PAW Daemon Process Ownership
 *
 * @fileoverview Process table filtered down to processes PAW own: daemon itself
 * and swarm workers born from it. Control API shows full machine process list,
 * even on loopback; any local reader sees every app running on host. Console
 * shows only processes owned by the daemon. Compute daemon process subtree by
 * walking parent→child relation.
 *
 * @module @paw/daemon/process
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { HostProcess } from '@paw/core';

/**
 * Collect process subtree rooted at pid: that process (if there) plus every
 * descendant, follow `ppid`. Unrelated processes out. `ppid` cycle stop, no loop.
 *
 * @param {readonly HostProcess[]} all - Full host process table.
 * @param {number} rootPid - Pid to root subtree at (daemon own pid).
 * @returns {HostProcess[]} Rooted subtree, breadth-first order.
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
