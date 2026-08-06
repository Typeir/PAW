/**
 * PAW Daemon Process Ownership Tests
 *
 * @fileoverview Covers `collectSubtree` — a normal tree (excluding unrelated
 * processes and grouping siblings), a root absent from the table but with
 * children, and a `ppid` cycle that must terminate — so `process.ts` reaches 100%
 * and the exposure filter can never silently widen.
 *
 * @module @paw/daemon/test/process
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import type { HostProcess } from '@paw/core';
import { collectSubtree } from '../src/process.js';

const p = (pid: number, ppid: number, name: string): HostProcess => ({ pid, ppid, name });

describe('collectSubtree', () => {
  it('returns the root and its descendants, excluding unrelated processes', () => {
    const all = [
      p(100, 1, 'pawd'),
      p(101, 100, 'worker-a'),
      p(102, 100, 'worker-b'),
      p(103, 101, 'grandchild'),
      p(900, 800, 'chrome'),
      p(901, 900, 'chrome-tab'),
    ];
    const owned = collectSubtree(all, 100).map((x) => x.pid).sort((a, b) => a - b);
    expect(owned).toEqual([100, 101, 102, 103]);
  });

  it('still collects children when the root process is absent from the table', () => {
    const owned = collectSubtree([p(200, 100, 'worker')], 100);
    expect(owned.map((x) => x.pid)).toEqual([200]);
  });

  it('terminates on a ppid cycle instead of looping', () => {
    const all = [p(1, 2, 'a'), p(2, 1, 'b')];
    const owned = collectSubtree(all, 1).map((x) => x.pid).sort((a, b) => a - b);
    expect(owned).toEqual([1, 2]);
  });
});
