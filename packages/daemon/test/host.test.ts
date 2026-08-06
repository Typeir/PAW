/**
 * PAW Daemon Host Tests
 *
 * @fileoverview Covers `readHostInfo`'s mapping from the injected process/os seams
 * to {@link HostInfo}, including the uptime rounding — so `host.ts` reaches 100%.
 *
 * @module @paw/daemon/test/host
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { readHostInfo, type OsLike, type ProcLike } from '../src/host.js';

const proc: ProcLike = {
  pid: 4242,
  ppid: 17,
  version: 'v22.23.1',
  uptime: () => 8000.9,
  memoryUsage: () => ({ rss: 100 * 1024 * 1024 }),
  cwd: () => '/work/ikuisuus',
};

const os: OsLike = {
  hostname: () => 'anvil',
  platform: () => 'win32',
  release: () => '10.0.26200',
  cpus: () => [1, 2, 3, 4, 5, 6, 7, 8],
};

describe('readHostInfo', () => {
  it('maps the real process and os facts, rounding uptime', () => {
    expect(readHostInfo(proc, os)).toEqual({
      pid: 4242,
      ppid: 17,
      uptimeSec: 8001,
      rssBytes: 100 * 1024 * 1024,
      hostname: 'anvil',
      platform: 'win32',
      release: '10.0.26200',
      cpus: 8,
      node: 'v22.23.1',
      cwd: '/work/ikuisuus',
    });
  });
});
