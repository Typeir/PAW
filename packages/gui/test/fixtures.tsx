/**
 * PAW GUI Test Fixtures
 *
 * @fileoverview One {@link PawSnapshot} represents the exact snapshot shape
 * `pawd` sends to the GUI. Two render helpers: one mounts a single panel inside
 * the provider, one mounts the whole console. Fixture covers every branch:
 * four-member plan, doctor roles bound / unbound-optional / blocking, plan
 * findings pass and fail, run members cover all four state values with null
 * level, violations direct (critical) and indirect (warning). No `.test.tsx`,
 * so the file never runs as a suite and never counts toward coverage.
 *
 * @module @paw/gui/test/fixtures
 */

import type { PawSnapshot } from '@paw/core';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ConsoleProvider } from '../src/application/context/consoleContext.js';
import type { SnapshotSource } from '../src/application/hooks/useLiveRefresh.js';
import { ConsoleApp } from '../src/presentation/consoleApp.js';

/**
 * Base snapshot each test start from.
 */
const BASE: PawSnapshot = {
  host: {
    pid: 4242,
    ppid: 17,
    uptimeSec: 8054,
    rssBytes: 100 * 1024 * 1024,
    hostname: 'LAPTOP-TEST',
    platform: 'win32',
    release: '10.0.26200',
    cpus: 24,
    node: 'v22.23.1',
    cwd: 'C:\\paw',
  },
  processes: [
    { pid: 4242, ppid: 17, name: 'node.exe' },
    { pid: 4310, ppid: 4242, name: 'worker.exe' },
  ],
  root: 'C:\\code\\demo',
  configPath: '.paw/config.json',
  plans: ['plans/demo.swarm.mjs', 'plans/other.swarm.mjs'],
  selectedPlan: 'plans/demo.swarm.mjs',
  planName: 'demo',
  planRole: 'lore.author',
  memberTotal: 4,
  planSource: "const x = 'hi';\nconst y = `${x} there`;",
  highlightLine: 1,
  briefs: [
    'brief 1/4: alpha <&>"\'',
    'brief 2/4: beta',
    'brief 3/4: gamma',
    'brief 4/4: delta',
  ],
  slugs: ['alpha', 'beta', 'gamma', 'delta'],
  doctor: {
    ok: false,
    config: [{ field: 'models', message: 'no models declared' }],
    roles: [
      {
        role: 'lore.author',
        optional: false,
        boundTo: 'deepseek-chat',
        satisfaction: { ok: true, reasons: [] },
        blocking: false,
      },
      { role: 'memory.draft', optional: true, boundTo: null, satisfaction: null, blocking: false },
      {
        role: 'review.judge',
        optional: false,
        boundTo: 'weak',
        satisfaction: { ok: false, reasons: ['requires reasoning'] },
        blocking: true,
      },
    ],
  },
  planFindings: [
    { check: 'count', ok: true },
    { check: 'total-brief', ok: false, detail: 'member 3 empty' },
    { check: 'file-conflict', ok: true },
  ],
  run: {
    id: '15-40-02',
    startedAt: '2026-08-05T15-40-02',
    skipped: 1,
    done: 1,
    running: 1,
    failed: 1,
    confirmed: 1,
    members: [
      { member: 0, key: 'alpha', state: 'done', level: 2 },
      { member: 1, key: 'beta', state: 'skipped', level: null },
      { member: 2, key: 'gamma', state: 'running', level: 5 },
      { member: 3, key: 'delta', state: 'failed', level: 9, note: 'boom' },
    ],
  },
  budget: { spendUsd: 0.03, tokensIn: 41280, tokensOut: 9130 },
  violations: [
    { id: 1, filePath: 'src/a.ts', rule: 'r1', message: 'direct & <b> "x"', indirectFix: false },
    { id: 2, filePath: 'src/b.ts', rule: 'r2', message: 'indirect', indirectFix: true },
  ],
  daemon: {
    live: true,
    uptimeLabel: '2h14m',
    pid: 4242,
    socket: '127.0.0.1:8971',
    rssMb: 100,
    proto: 'v1',
    storeWriters: 1,
  },
  chrome: { gates: 11, keys: 1 },
};

/**
 * Build snapshot. Optionally override fields.
 *
 * @param {Partial<PawSnapshot>} [over] - Fields to override.
 * @returns {PawSnapshot} Snapshot result.
 */
export function makeSnapshot(over: Partial<PawSnapshot> = {}): PawSnapshot {
  return { ...BASE, ...over };
}

/**
 * Mount panel inside console provider.
 *
 * @param {ReactNode} ui - UI to mount.
 * @param {PawSnapshot} [snapshot] - Snapshot to provide.
 * @returns {RenderResult} Render result.
 */
export function renderInConsole(ui: ReactNode, snapshot: PawSnapshot = makeSnapshot()): RenderResult {
  return render(<ConsoleProvider snapshot={snapshot}>{ui}</ConsoleProvider>);
}

/**
 * Mount whole console.
 *
 * @param {PawSnapshot} [snapshot] - Snapshot to boot from.
 * @param {SnapshotSource | null} [source] - Live source to poll.
 * @param {number} [intervalMs] - Poll period.
 * @returns {RenderResult} Render result.
 */
export function renderConsole(
  snapshot: PawSnapshot = makeSnapshot(),
  source: SnapshotSource | null = null,
  intervalMs?: number,
): RenderResult {
  return render(<ConsoleApp snapshot={snapshot} source={source} intervalMs={intervalMs} />);
}
