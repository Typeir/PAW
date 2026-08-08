/**
 * Slice Cache Tests
 *
 * @fileoverview Whether the cache actually avoids work, proven by counting
 * builder calls rather than by checking the value came back — a cache that
 * returns the right answer while recomputing it every time passes the second
 * test and fails the only one that matters.
 *
 * @module @paw/daemon/test/cache
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type {
  BudgetSummary,
  DoctorReport,
  HostInfo,
  PlansSlice,
  RunProgress,
  SwarmPlan,
} from '@paw/core';
import { describe, expect, it, vi } from 'vitest';
import {
  buildPlanSlice,
  composeSnapshot,
  createVersionedCache,
  emptyPlanSlice,
  idleBudget,
  idleRun,
} from '../src/domain/cache.js';

const HOST: HostInfo = {
  pid: 42,
  ppid: 7,
  uptimeSec: 3754,
  rssBytes: 5 * 1024 * 1024,
  hostname: 'box',
  platform: 'linux',
  release: '6.1',
  cpus: 8,
  node: 'v22.0.0',
  cwd: '/paw',
};

const DOCTOR: DoctorReport = { ok: true, roles: [], findings: [] } as unknown as DoctorReport;
const PLANS: PlansSlice = { plans: ['a.swarm.mjs'], configPath: '.paw/config.json' };

/**
 * A plan whose briefs are cheap but countable.
 *
 * @param {number} members - How many members it has.
 * @returns {SwarmPlan<{ files: string[] }>} The plan.
 */
const planOf = (members: number): SwarmPlan<{ files: string[] }> => ({
  name: 'lore',
  role: 'edit.apply',
  args: { files: Array.from({ length: members }, (_v, i) => `doc/${i}.mdx`) },
  members: (args) => args.files.length,
  brief: (args, member, total) => `lore ${member + 1}/${total}: ${args.files[member]}`,
  key: (args, member) => args.files[member],
});

describe('createVersionedCache', () => {
  it('builds once and returns the same value while the version holds', () => {
    const cache = createVersionedCache<string>();
    const build = vi.fn(() => 'value');

    expect(cache.read('plan.mjs', 100, build)).toBe('value');
    expect(cache.read('plan.mjs', 100, build)).toBe('value');
    expect(cache.read('plan.mjs', 100, build)).toBe('value');

    expect(build).toHaveBeenCalledTimes(1);
    expect(cache.size()).toBe(1);
  });

  it('rebuilds the moment the version moves', () => {
    const cache = createVersionedCache<number>();
    let built = 0;
    const build = (): number => (built += 1);

    expect(cache.read('plan.mjs', 100, build)).toBe(1);
    expect(cache.read('plan.mjs', 101, build)).toBe(2);
    expect(cache.read('plan.mjs', 101, build)).toBe(2);
    expect(built).toBe(2);
  });

  it('rebuilds when a version goes backwards, rather than trusting the newer one', () => {
    const cache = createVersionedCache<string>();
    const build = vi.fn((): string => 'v');
    cache.read('k', 200, build);
    // A restored file has an older mtime and is genuinely different content;
    // treating "not newer" as "unchanged" would serve the wrong plan.
    cache.read('k', 100, build);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('keeps entries apart by key', () => {
    const cache = createVersionedCache<string>();
    cache.read('a', 1, () => 'A');
    cache.read('b', 1, () => 'B');
    expect(cache.read('a', 1, () => 'rebuilt')).toBe('A');
    expect(cache.read('b', 1, () => 'rebuilt')).toBe('B');
    expect(cache.size()).toBe(2);
  });

  it('forgets an entry on request, and forgetting an absent one is harmless', () => {
    const cache = createVersionedCache<string>();
    cache.read('a', 1, () => 'A');
    cache.forget('a');
    cache.forget('never-existed');
    expect(cache.size()).toBe(0);
    expect(cache.read('a', 1, () => 'fresh')).toBe('fresh');
  });
});

describe('buildPlanSlice', () => {
  it('renders one brief and one key per member', () => {
    const slice = buildPlanSlice(planOf(3), 'export default {}', 'plans/lore.swarm.mjs');

    expect(slice.selectedPlan).toBe('plans/lore.swarm.mjs');
    expect(slice.planName).toBe('lore');
    expect(slice.planRole).toBe('edit.apply');
    expect(slice.memberTotal).toBe(3);
    expect(slice.briefs).toEqual([
      'lore 1/3: doc/0.mdx',
      'lore 2/3: doc/1.mdx',
      'lore 3/3: doc/2.mdx',
    ]);
    expect(slice.slugs).toEqual(['doc/0.mdx', 'doc/1.mdx', 'doc/2.mdx']);
    expect(slice.planSource).toBe('export default {}');
    expect(slice.highlightLine).toBe(0);
  });

  it('is the expensive call, and the cache is what stops it happening per request', () => {
    const cache = createVersionedCache<ReturnType<typeof buildPlanSlice>>();
    const plan = planOf(400);
    const brief = vi.spyOn(plan, 'brief');

    cache.read('lore', 7, () => buildPlanSlice(plan, 'src', 'lore'));
    // More than one render per member: the plan doctor renders them again to
    // check them, so a cache miss costs over 800 template renders here.
    expect(brief.mock.calls.length).toBeGreaterThanOrEqual(400);

    brief.mockClear();
    cache.read('lore', 7, () => buildPlanSlice(plan, 'src', 'lore'));
    cache.read('lore', 7, () => buildPlanSlice(plan, 'src', 'lore'));

    // Two more reads of an unchanged plan: zero renders. This is the sweep's
    // item 5 — hundreds of briefs every three seconds, per open console, gone.
    expect(brief).not.toHaveBeenCalled();
  });
});

describe('emptyPlanSlice', () => {
  it('shows nothing rather than the last plan’s briefs', () => {
    const slice = emptyPlanSlice();
    expect(slice.selectedPlan).toBeNull();
    expect(slice.planName).toBe('');
    expect(slice.memberTotal).toBe(0);
    expect(slice.briefs).toEqual([]);
    expect(slice.slugs).toEqual([]);
    expect(slice.planFindings).toEqual([]);
  });
});

describe('composeSnapshot', () => {
  const parts = {
    host: HOST,
    processes: [{ pid: 42, ppid: 7, name: 'node' }],
    plans: PLANS,
    planDetail: buildPlanSlice(planOf(2), 'source', 'a.swarm.mjs'),
    doctor: DOCTOR,
    run: idleRun('15-40-02', '2026-08-06T15:40:02.000Z') as RunProgress,
    budget: idleBudget() as BudgetSummary,
    violations: [],
    socket: '127.0.0.1:8971',
    gates: 3,
    keys: 2,
  };

  it('flattens the slices into the shape a console renders', () => {
    const snapshot = composeSnapshot(parts);

    expect(snapshot.configPath).toBe('.paw/config.json');
    expect(snapshot.plans).toEqual(['a.swarm.mjs']);
    expect(snapshot.selectedPlan).toBe('a.swarm.mjs');
    expect(snapshot.planName).toBe('lore');
    expect(snapshot.memberTotal).toBe(2);
    expect(snapshot.briefs).toHaveLength(2);
    expect(snapshot.doctor).toBe(DOCTOR);
    expect(snapshot.chrome).toEqual({ gates: 3, keys: 2 });
  });

  it('derives the daemon status line from the host it was handed', () => {
    const snapshot = composeSnapshot(parts);
    expect(snapshot.daemon.pid).toBe(42);
    expect(snapshot.daemon.socket).toBe('127.0.0.1:8971');
    expect(snapshot.daemon.rssMb).toBe(5);
    expect(snapshot.daemon.uptimeLabel).toBe('1h02m');
    expect(snapshot.daemon.live).toBe(true);
    expect(snapshot.daemon.proto).toBe('v1');
  });

  it('computes nothing expensive — the slices it is given are the slices it ships', () => {
    const snapshot = composeSnapshot(parts);
    expect(snapshot.briefs).toBe(parts.planDetail.briefs);
    expect(snapshot.slugs).toBe(parts.planDetail.slugs);
    expect(snapshot.planFindings).toBe(parts.planDetail.planFindings);
    expect(snapshot.processes).toBe(parts.processes);
  });

  it('reports an empty selection honestly', () => {
    const snapshot = composeSnapshot({ ...parts, planDetail: emptyPlanSlice() });
    expect(snapshot.selectedPlan).toBeNull();
    expect(snapshot.planName).toBe('');
    expect(snapshot.briefs).toEqual([]);
  });
});

describe('idleRun and idleBudget', () => {
  it('report zeros and an empty herd, not a plausible fiction', () => {
    expect(idleRun('r1', 'then')).toEqual({
      id: 'r1',
      startedAt: 'then',
      skipped: 0,
      done: 0,
      running: 0,
      failed: 0,
      confirmed: 0,
      members: [],
    });
    expect(idleBudget()).toEqual({ spendUsd: 0, tokensIn: 0, tokensOut: 0 });
  });
});
