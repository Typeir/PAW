/**
 * PAW Daemon Host Facts
 *
 * @fileoverview Reads real facts about the machine the daemon runs on — the pid,
 * uptime, resident memory, hostname, platform, and CPU count — from `process` and
 * `os`. Both are taken as injected seams ({@link ProcLike}, {@link OsLike}) so the
 * mapping is a pure function tested against fakes, while `main.ts` passes the real
 * globals. This is the literal "process data from the host machine": no fixture,
 * the numbers are whatever the OS reports at the moment of the call.
 *
 * @module @paw/daemon/host
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { HostInfo } from '@paw/core';

/**
 * The slice of Node's `process` the host reader needs.
 *
 * @interface ProcLike
 * @property {number} pid - The process id.
 * @property {number} ppid - The parent process id.
 * @property {string} version - The Node version string.
 * @property {() => number} uptime - Seconds the process has been alive.
 * @property {() => { rss: number }} memoryUsage - Memory usage, resident set size in bytes.
 * @property {() => string} cwd - The working directory.
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
 * The slice of Node's `os` the host reader needs.
 *
 * @interface OsLike
 * @property {() => string} hostname - The machine hostname.
 * @property {() => string} platform - The platform (win32/darwin/linux).
 * @property {() => string} release - The OS release string.
 * @property {() => unknown[]} cpus - The logical CPUs (only the count is used).
 */
export interface OsLike {
  hostname(): string;
  platform(): string;
  release(): string;
  cpus(): unknown[];
}

/**
 * Read the host facts from the injected process and os.
 *
 * @param {ProcLike} proc - The process seam (real `process`).
 * @param {OsLike} os - The os seam (real `node:os`).
 * @returns {HostInfo} The host facts at this instant.
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
