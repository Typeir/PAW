/**
 * PAW Daemon Host Facts
 *
 * @fileoverview Read facts about machine daemon run on — pid, uptime, resident
 * memory, hostname, platform, cpu count — from `process` and `os`. Both be
 * injected seams ({@link ProcLike}, {@link OsLike}); mapping be pure function
 * tested against fakes, and `main.ts` pass real globals. Numbers be what OS
 * report at moment of call.
 *
 * @module @paw/daemon/host
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { HostInfo } from '@paw/core';

/**
 * Slice of Node `process` host reader need.
 *
 * @interface ProcLike
 * @property {number} pid - Process id.
 * @property {number} ppid - Parent process id.
 * @property {string} version - Node version string.
 * @property {() => number} uptime - Seconds process alive.
 * @property {() => { rss: number }} memoryUsage - Memory usage, resident set size in bytes.
 * @property {() => string} cwd - Working directory.
 */
export interface ProcLike {
  readonly pid: number;
  readonly ppid: number;
  readonly version: string;
  uptime(): number;
  memoryUsage(): { rss: number };
  cwd(): string;
}

/**
 * Slice of Node `os` host reader need.
 *
 * @interface OsLike
 * @property {() => string} hostname - Machine hostname.
 * @property {() => string} platform - Platform (win32/darwin/linux).
 * @property {() => string} release - OS release string.
 * @property {() => unknown[]} cpus - Logical CPUs (only count used).
 */
export interface OsLike {
  hostname(): string;
  platform(): string;
  release(): string;
  cpus(): unknown[];
}

/**
 * Read host facts from injected process and os.
 *
 * @param {ProcLike} proc - Process seam (real `process`).
 * @param {OsLike} os - Os seam (real `node:os`).
 * @returns {HostInfo} Host facts at this instant.
 */
export function readHostInfo(proc: ProcLike, os: OsLike): HostInfo {
  return {
    pid: proc.pid,
    ppid: proc.ppid,
    uptimeSec: Math.round(proc.uptime()),
    rssBytes: proc.memoryUsage().rss,
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    cpus: os.cpus().length,
    node: proc.version,
    cwd: proc.cwd(),
  };
}
