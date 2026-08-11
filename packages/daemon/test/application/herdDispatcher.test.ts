/**
 * @fileoverview Cover {@link dispatcherFor}, shared run-engine both CLI's
 * `paw ui` and daemon's release handler build run from: give RunSettings and
 * injected collaborators, return dispatcher that open right registry
 * (live vs fake), meter bound port, forward run's ceiling and concurrency
 * to dispatch, attach context to plan, write each member, always close
 * live client. Prove with fakes — no SDK, no dispatchSwarm internals.
 *
 * @module @paw/daemon/test/application/herdDispatcher
 */

import type {
  DispatchDeps,
  DispatchEvent,
  DispatchResult,
  FileReaderPort,
  ModelPort,
  ModelRequest,
  RoleRegistry,
  RunSettings,
  SwarmPlan,
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
});
