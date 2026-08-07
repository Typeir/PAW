/**
 * Snapshot Formatting Tests
 *
 * @fileoverview The three arms of the uptime label. The snapshot's assembly is
 * tested in `cache.test.ts`, which is where it now happens.
 *
 * @module @paw/daemon/test/snapshot
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { formatUptime } from '../src/snapshot.js';

describe('formatUptime', () => {
  it('drops to the largest unit that fits, and pads the smaller one', () => {
    expect(formatUptime(8000)).toBe('2h13m');
    expect(formatUptime(125)).toBe('2m05s');
    expect(formatUptime(9)).toBe('09s');
  });

  it('handles the boundaries between the arms', () => {
    expect(formatUptime(0)).toBe('00s');
    expect(formatUptime(59)).toBe('59s');
    expect(formatUptime(60)).toBe('1m00s');
    expect(formatUptime(3599)).toBe('59m59s');
    expect(formatUptime(3600)).toBe('1h00m');
  });
});
