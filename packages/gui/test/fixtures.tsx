/**
 * PAW GUI Test Fixtures
 *
 * @fileoverview A representative {@link PawSnapshot} — the exact shape `pawd`
 * serves — plus the two render helpers the suite uses: one that mounts a single
 * panel inside a provider, and one that mounts the whole console. The fixture is
 * shaped to exercise every branch: a four-member plan, doctor roles covering
 * bound / unbound-optional / blocking, plan findings covering pass and fail, a
 * herd covering all four member states with a null level, and violations
 * covering direct (critical) and indirect (warning). Not a `.test.tsx`, so it
 * never runs as a suite and never counts toward coverage.
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
 * The base snapshot every test starts from.
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
 * Build a snapshot with optional overrides.
 *
 * @param {Partial<PawSnapshot>} [over] - Fields to override.
 * @returns {PawSnapshot} The snapshot.
 */
export function makeSnapshot(over: Partial<PawSnapshot> = {}): PawSnapshot {
  return { ...BASE, ...over };
}

/**
 * Mount a panel inside a console provider.
 *
 * @param {ReactNode} ui - The panel under test.
 * @param {PawSnapshot} [snapshot] - The snapshot to provide.
 * @returns {RenderResult} The render result.
 */
export function renderInConsole(ui: ReactNode, snapshot: PawSnapshot = makeSnapshot()): RenderResult {
  return render(<ConsoleProvider snapshot={snapshot}>{ui}</ConsoleProvider>);
}

/**
 * Mount the whole console.
 *
 * @param {PawSnapshot} [snapshot] - The snapshot to boot from.
 * @param {SnapshotSource | null} [source] - A live source to poll.
 * @param {number} [intervalMs] - The poll period.
 * @returns {RenderResult} The render result.
 */
export function renderConsole(
  snapshot: PawSnapshot = makeSnapshot(),
  source: SnapshotSource | null = null,
  intervalMs?: number,
): RenderResult {
  return render(<ConsoleApp snapshot={snapshot} source={source} intervalMs={intervalMs} />);
}
