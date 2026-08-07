/**
 * PAW Dispatch Concurrency Tests
 *
 * @fileoverview Pins that a herd is dispatched in batches rather than one member
 * at a time, and that batching changes only how fast the run goes — never what
 * it returns. A run of four hundred members against a real provider is minutes
 * of wall clock spent waiting on a network that was happy to take the next
 * request, so the concurrency is the point; the ordering guarantees below are
 * what make it safe to have.
 *
 * @module @paw/core/test/application/dispatchConcurrency
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONCURRENCY,
  dispatchSwarm,
} from '../../src/application/dispatchSwarm.js';
import type { RoleRegistry } from '../../src/application/roleRegistry.js';
import type { ModelCapabilities, RoleDeclaration } from '../../src/domain/role.js';
import type { FileReaderPort, ModelPort } from '../../src/ports/index.js';
import type { SwarmPlan } from '../../src/domain/swarm.js';

const FILES: FileReaderPort = { read: async () => 'context' };

/**
 * A plan of `n` members whose brief names the member.
 *
 * @param {number} n - How many members.
 * @returns {SwarmPlan<{ n: number }>} The plan.
 */
function planOf(n: number): SwarmPlan<{ n: number }> {
  return {
    name: 'herd',
    role: 'edit.apply',
    args: { n },
    members: (args) => args.n,
    key: (_args, member) => `m${member}`,
    brief: (_args, member) => `brief ${member}`,
  };
}

const CAP: ModelCapabilities = {
  contextTokens: 128_000,
  maxOutputTokens: 8_192,
  tools: true,
  structuredOutput: true,
  reasoning: false,
  vision: false,
  costClass: 'cheap',
};

const editRole: RoleDeclaration = {
  id: 'edit.apply',
  owner: 'swarm',
  purpose: 'apply an edit',
  optional: false,
  requires: {
    minContextTokens: 32_000,
    maxOutputTokens: 4_096,
    tools: true,
    structuredOutput: false,
    reasoning: false,
    vision: false,
    costClass: 'standard',
    latencyClass: 'batch',
  },
};

/**
 * A registry binding `edit.apply` to the given model.
 *
 * @param {ModelPort} port - The model to bind.
 * @returns {RoleRegistry} The registry.
 */
function registryFor(port: ModelPort): RoleRegistry {
  return {
    declarations: new Map([[editRole.id, editRole]]),
    bindings: new Map([['edit.apply', { modelId: 'ds-flash', capabilities: CAP, port }]]),
  };
}

/**
 * A model that holds each call open until released, recording how many were in
 * flight at once.
 *
 * @returns {object} The port, its peak overlap, and a release trigger.
 */
function trackingModel() {
  let inFlight = 0;
  let peak = 0;
  const gates: (() => void)[] = [];
  const port: ModelPort = {
    complete: async (request) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => gates.push(resolve));
      inFlight -= 1;
      return { content: `answer to ${request.prompt}` };
    },
  } as ModelPort;
  const releaseAll = (): void => {
    while (gates.length > 0) {
      gates.shift()?.();
    }
  };
  return { port, peak: () => peak, releaseAll, waiting: () => gates.length };
}

describe('dispatchSwarm concurrency', () => {
  it('runs members in parallel up to the bound', async () => {
    const model = trackingModel();
    const run = dispatchSwarm(planOf(10), {
      registry: registryFor(model.port),
      files: FILES,
      concurrency: 4,
    });

    await new Promise((r) => setTimeout(r, 5));
    expect(model.waiting()).toBe(4);

    const drain = setInterval(() => model.releaseAll(), 1);
    const result = await run;
    clearInterval(drain);

    expect(model.peak()).toBe(4);
    expect(result.outcomes).toHaveLength(10);
  });

  it('returns outcomes in member order however they finish', async () => {
    const model = trackingModel();
    const run = dispatchSwarm(planOf(8), {
      registry: registryFor(model.port),
      files: FILES,
      concurrency: 8,
    });
    await new Promise((r) => setTimeout(r, 5));
    const drain = setInterval(() => model.releaseAll(), 1);
    const result = await run;
    clearInterval(drain);

    expect(result.outcomes.map((o) => o.member)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.outcomes[3].content).toBe('answer to brief 3');
  });

  it('runs one at a time when the bound is one', async () => {
    const model = trackingModel();
    const run = dispatchSwarm(planOf(5), {
      registry: registryFor(model.port),
      files: FILES,
      concurrency: 1,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(model.waiting()).toBe(1);
    const drain = setInterval(() => model.releaseAll(), 1);
    await run;
    clearInterval(drain);
    expect(model.peak()).toBe(1);
  });

  it('defaults to a bound rather than dispatching every member at once', async () => {
    const model = trackingModel();
    const run = dispatchSwarm(planOf(64), {
      registry: registryFor(model.port),
      files: FILES,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(model.waiting()).toBe(DEFAULT_CONCURRENCY);
    const drain = setInterval(() => model.releaseAll(), 1);
    await run;
    clearInterval(drain);
    expect(model.peak()).toBe(DEFAULT_CONCURRENCY);
  });

  it('never exceeds the member count', async () => {
    const model = trackingModel();
    const run = dispatchSwarm(planOf(2), {
      registry: registryFor(model.port),
      files: FILES,
      concurrency: 16,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(model.waiting()).toBe(2);
    const drain = setInterval(() => model.releaseAll(), 1);
    await run;
    clearInterval(drain);
  });

  it('treats a bound below one as one rather than stalling forever', async () => {
    const model = trackingModel();
    const run = dispatchSwarm(planOf(3), {
      registry: registryFor(model.port),
      files: FILES,
      concurrency: 0,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(model.waiting()).toBe(1);
    const drain = setInterval(() => model.releaseAll(), 1);
    await run;
    clearInterval(drain);
  });

  it('lets members already in flight settle before it fails, so paid work is reported', async () => {
    const started: number[] = [];
    const settled: number[] = [];
    const port: ModelPort = {
      complete: async (request) => {
        const member = Number(/brief (\d+)/.exec(request.prompt)?.[1]);
        if (member === 1) {
          throw new Error('provider said no');
        }
        return { content: `ok ${member}` };
      },
    } as ModelPort;

    await expect(
      dispatchSwarm(planOf(6), {
        registry: registryFor(port),
        files: FILES,
        concurrency: 3,
        onProgress: (event) => {
          if (event.phase === 'started') started.push(event.member);
          if (event.phase === 'settled') settled.push(event.member);
        },
      }),
    ).rejects.toThrow('provider said no');

    expect(settled).toContain(0);
    expect(settled).toContain(2);
    expect(settled).not.toContain(1);
    expect(started.length).toBeLessThan(6);
  });

  it('still honours resume and skip under concurrency', async () => {
    const model = trackingModel();
    const run = dispatchSwarm(planOf(6), {
      registry: registryFor(model.port),
      files: FILES,
      concurrency: 3,
      alreadyDone: (key) => key === 'm0',
      skip: (_plan, member) => member === 5,
    });
    await new Promise((r) => setTimeout(r, 5));
    const drain = setInterval(() => model.releaseAll(), 1);
    const result = await run;
    clearInterval(drain);

    expect(result.outcomes[0].state).toBe('skipped');
    expect(result.outcomes[5].state).toBe('skipped');
    expect(result.outcomes[1].state).toBe('done');
    expect(result.outcomes.map((o) => o.member)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
