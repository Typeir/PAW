/**
 * @fileoverview Cover {@link dispatcherFor}, shared run-engine both CLI's
 * `paw ui` and daemon's release handler build run from: give RunSettings and
 * injected collaborators, return dispatcher that open right registry
 * (live vs fake), meter bound port, forward run's ceiling and concurrency
 * to dispatch, attach context to plan, write each member, always close
 * live client. Every run is proved against `expectFiles`; a live run pre-creates
 * missing targets and, when held to gates, judges open violations in them.
 * Prove with fakes — no SDK, no dispatchSwarm internals.
 *
 * @module @paw/daemon/test/application/herdDispatcher
 */

import type {
  DispatchDeps,
  DispatchEvent,
  DispatchResult,
  FileReaderPort,
  FileSystemPort,
  ModelPort,
  ModelRequest,
  RoleRegistry,
  RunSettings,
  SwarmPlan,
  Violation,
} from '@paw/core';
import { describe, expect, it, vi } from 'vitest';
import { dispatcherFor, type HerdDeps } from '../../src/application/herdDispatcher.js';

const PLAN: SwarmPlan<unknown> = {
  name: 'lore',
  role: 'lore.author',
  args: {},
  members: 2,
  brief: () => 'write',
};

const RESULT: DispatchResult = { released: true, outcomes: [] } as unknown as DispatchResult;

const capturingPort = (calls: ModelRequest[]): ModelPort => ({
  complete: async (req) => {
    calls.push(req);
    return { content: 'x', inputTokens: 3, outputTokens: 2 };
  },
});

function registryWith(port: ModelPort): RoleRegistry {
  return {
    declarations: new Map(),
    bindings: new Map([['lore.author', { modelId: 'm', capabilities: {} as never, port }]]),
  } as unknown as RoleRegistry;
}

const noWriter = { onProgress: async () => undefined, written: () => [] };
const files = {} as FileReaderPort;

/**
 * In-memory file system over a path → content map.
 *
 * @param {Map<string, string>} disk - Backing store; absent path reads empty.
 * @returns {FileSystemPort} The port.
 */
function memFs(disk: Map<string, string>): FileSystemPort {
  return {
    readText: async (path) => disk.get(path) ?? '',
    writeText: async (path, content) => {
      disk.set(path, content);
    },
    appendText: async () => undefined,
    ensureDir: async () => undefined,
    setExecutable: async () => undefined,
  };
}

const TARGETED: SwarmPlan<unknown> = {
  ...PLAN,
  expectFiles: (_args, member) => (member === 0 ? 'src/cart.ts' : 'src/pay.ts'),
};

const OPEN: Violation = {
  id: 1,
  filePath: 'src/cart.ts',
  rule: 'no-console',
  message: 'console output',
  indirectFix: false,
};

const RAN: DispatchResult = {
  released: true,
  outcomes: [
    { member: 0, key: 'cart', state: 'done', content: 'ok' },
    { member: 1, key: 'pay', state: 'done', content: 'ok' },
  ],
} as unknown as DispatchResult;

/**
 * Build deps whose dispatch record what it get handed and drive one member so
 * metered port get exercised.
 *
 * @param over - Overrides.
 */
function deps(over: Partial<HerdDeps> = {}): {
  deps: HerdDeps;
  seen: { registry?: RoleRegistry; d?: DispatchDeps<unknown>; planName?: string };
  calls: ModelRequest[];
} {
  const calls: ModelRequest[] = [];
  const seen: { registry?: RoleRegistry; d?: DispatchDeps<unknown>; planName?: string } = {};
  const base: HerdDeps = {
    openLive: async (plan) => ({ registry: registryWith(capturingPort(calls)), close: async () => undefined }),
    fakeRegistry: () => registryWith(capturingPort(calls)),
    withContext: (plan) => ({ ...plan, name: `${plan.name}+ctx` }),
    resolveContext: async () => ['a.ts'],
    files,
    makeWriter: () => noWriter,
    fs: memFs(new Map()),
    violations: async () => [],
    dispatch: async (plan, d) => {
      seen.planName = plan.name;
      seen.d = d;
      seen.registry = d.registry;
      const binding = d.registry.bindings.get(plan.role);
      await binding?.port.complete({ model: 'm', prompt: 'p', maxOutputTokens: d.maxOutputTokens });
      return RESULT;
    },
    ...over,
  };
  return { deps: base, seen, calls };
}

describe('dispatcherFor', () => {
  it('opens a live herd with gates on unless the settings turn them off', async () => {
    const openLive = vi.fn(async (_plan: SwarmPlan<unknown>, _gates: boolean) => ({
      registry: registryWith(capturingPort([])),
      close: async () => undefined,
    }));
    const { deps: d } = deps({ openLive });
    await dispatcherFor({ plan: 'lore.swarm.mjs', live: true }, d)(PLAN, () => undefined);
    await dispatcherFor({ plan: 'lore.swarm.mjs', live: true, gates: false }, d)(PLAN, () => undefined);
    expect(openLive.mock.calls.map((call) => call[1])).toEqual([true, false]);
  });

  it('opens the live registry, meters it, forwards settings, and closes', async () => {
    const close = vi.fn(async () => undefined);
    const { deps: d, seen, calls } = deps({
      openLive: async () => ({ registry: registryWith(capturingPort([])), close }),
    });
    const dispatch = dispatcherFor(
      { plan: 'lore.swarm.mjs', live: true, maxOutputTokens: 512, concurrency: 4, context: ['x'] },
      d,
    );

    const report = await dispatch(PLAN, () => undefined);

    expect(report.result).toBe(RESULT);
    expect(seen.d?.maxOutputTokens).toBe(512);
    expect(seen.d?.concurrency).toBe(4);
    expect(seen.planName).toBe('lore+ctx');
    expect(close).toHaveBeenCalledOnce();
  });

  it('uses the fake registry and needs no close when not live', async () => {
    const openLive = vi.fn();
    const { deps: d } = deps({ openLive: openLive as never });
    const report = await dispatcherFor({ plan: 'p', live: false }, d)(PLAN, () => undefined);
    expect(report.result).toBe(RESULT);
    expect(openLive).not.toHaveBeenCalled();
  });

  it('meters the run, so usage reflects what the port reported', async () => {
    const { deps: d } = deps();
    const report = await dispatcherFor({ plan: 'p', live: false }, d)(PLAN, () => undefined);
    expect(report.usage).toEqual({ spendUsd: 0, tokensIn: 3, tokensOut: 2 });
  });

  it('forwards progress to the caller and the writer', async () => {
    const events: DispatchEvent[] = [];
    const writer = { onProgress: vi.fn(async () => undefined), written: () => [] };
    const { deps: d } = deps({
      makeWriter: () => writer,
      dispatch: async (plan, dd) => {
        await dd.onProgress?.({ phase: 'started', member: 0, key: 'k', total: 1 } as DispatchEvent);
        return RESULT;
      },
    });
    await dispatcherFor({ plan: 'p', live: false }, d)(PLAN, (e) => {
      events.push(e);
    });
    expect(events).toHaveLength(1);
    expect(writer.onProgress).toHaveBeenCalledOnce();
  });

  it('omits context resolution when the run names none, and still closes on a bind failure', async () => {
    const resolveContext = vi.fn(async () => ['a.ts']);
    const close = vi.fn(async () => undefined);
    const { deps: d } = deps({
      resolveContext,
      openLive: async () => ({ registry: { declarations: new Map(), bindings: new Map() } as RoleRegistry, close }),
    });
    await expect(
      dispatcherFor({ plan: 'p', live: true }, d)(PLAN, () => undefined),
    ).rejects.toThrow(/bound to no model/);
    expect(resolveContext).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('pre-creates missing targets on a live run and judges open violations in them', async () => {
    const disk = new Map<string, string>();
    const { deps: d } = deps({
      fs: memFs(disk),
      violations: async () => [OPEN],
      dispatch: async () => {
        disk.set('src/cart.ts', 'console.log(1)');
        return RAN;
      },
    });
    const report = await dispatcherFor({ plan: 'p', live: true }, d)(TARGETED, () => undefined);

    expect(disk.get('src/pay.ts')).toBe('');
    expect(report.proofs.map((p) => p.state)).toEqual(['violating', 'unproved']);
    expect(report.proofs[0].violations).toEqual([OPEN]);
  });

  it('proves without judging violations when gates are off, and when no pawd answers', async () => {
    const violations = vi.fn(async () => [OPEN]);
    const written = (disk: Map<string, string>) => async () => {
      disk.set('src/cart.ts', 'a');
      disk.set('src/pay.ts', 'b');
      return RAN;
    };
    const off = new Map<string, string>();
    const gatesOff = await dispatcherFor(
      { plan: 'p', live: true, gates: false },
      deps({ fs: memFs(off), violations, dispatch: written(off) }).deps,
    )(TARGETED, () => undefined);
    expect(gatesOff.proofs.map((p) => p.state)).toEqual(['proved', 'proved']);
    expect(violations).not.toHaveBeenCalled();

    const down = new Map<string, string>();
    const unreachable = await dispatcherFor(
      { plan: 'p', live: true },
      deps({ fs: memFs(down), violations: async () => null, dispatch: written(down) }).deps,
    )(TARGETED, () => undefined);
    expect(unreachable.proofs.map((p) => p.state)).toEqual(['proved', 'proved']);
  });

  it('proves a fake run by what the writer wrote, creating no placeholders', async () => {
    const disk = new Map<string, string>();
    const { deps: d } = deps({
      fs: memFs(disk),
      makeWriter: () => ({ onProgress: async () => undefined, written: () => ['src/cart.ts'] }),
      dispatch: async () => RAN,
    });
    const report = await dispatcherFor({ plan: 'p', live: false }, d)(TARGETED, () => undefined);

    expect(disk.size).toBe(0);
    expect(report.proofs.map((p) => p.state)).toEqual(['proved', 'unproved']);
  });
});
