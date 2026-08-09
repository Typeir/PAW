/**
 * @fileoverview Unit tests for the daemon status/stop formatters. They pin the
 * running and the no-daemon rendering for both, so `daemonStatus.ts` reaches
 * 100% and a missing daemon reads as a plain state rather than a failure.
 *
 * @module @paw/cli/test/unit/daemonStatus
 */

import { describe, expect, it } from 'vitest';
import { formatDaemonStatus, formatDaemonStop } from '../../src/daemonStatus.js';

describe('formatDaemonStatus', () => {
  it('renders a running daemon', () => {
    const lines = formatDaemonStatus({
      pid: 4242,
      uptimeMs: 90_000,
      protocolVersion: 1,
      health: 'ok',
      projectRoot: '/repo',
    });
    expect(lines[0]).toContain('pid 4242');
    expect(lines[1]).toContain('uptime 90s');
    expect(lines[1]).toContain('protocol 1');
    expect(lines[2]).toContain('/repo');
  });

  it('reports the absence of a daemon', () => {
    expect(formatDaemonStatus(null)).toEqual(['no PAW daemon is running for this repository']);
  });
});

describe('formatDaemonStop', () => {
  it('confirms a stop', () => {
    expect(formatDaemonStop({ stopping: true })).toEqual(['PAW daemon stopping']);
  });

  it('reports the absence of a daemon', () => {
    expect(formatDaemonStop(null)).toEqual(['no PAW daemon is running for this repository']);
  });
});
