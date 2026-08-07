/**
 * PAW Dispatch-Swarm Tests
 *
 * @fileoverview Drives the full swarm loop against an inline fake model and role
 * registry — covering doctor-refusal, a clean dispatch, the skip predicate,
 * resume via alreadyDone, and the loud throw when a role resolves to no model —
 * so `dispatchSwarm.ts` reaches 100% with no adapter dependency and no provider.
 *
 * @module @paw/core/test/application/dispatchSwarm
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import type { ModelCapabilities, RoleDeclaration } from '../../src/domain/role.js';
import type { SwarmPlan } from '../../src/domain/swarm.js';
import type { FileReaderPort, ModelPort } from '../../src/ports/index.js';
import type {
  ModelBinding,
  RoleRegistry,
} from '../../src/application/roleRegistry.js';
import { dispatchSwarm } from '../../src/application/dispatchSwarm.js';
import type { DispatchEvent } from '../../src/application/dispatchSwarm.js';

/**
 * A model that echoes the prompt, so outcomes are inspectable.
 */
const echoModel: ModelPort = {
  complete: async (req) => ({
    content: `ran:${req.prompt}`,
    inputTokens: req.prompt.length,
    outputTokens: 1,
  }),
};

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
 * A registry binding `edit.apply` to the echo model.
 *
 * @param {Partial<ModelBinding>} bindingOver - Binding overrides.
 * @returns {RoleRegistry} A registry.
 */
const registry = (bindingOver: Partial<ModelBinding> = {}): RoleRegistry => ({
  declarations: new Map([[editRole.id, editRole]]),
  bindings: new Map([
    ['edit.apply', { modelId: 'ds-flash', capabilities: CAP, port: echoModel, ...bindingOver }],
  ]),
});

/**
 * A file reader over an in-memory filesystem, failing loud on a path it has
 * never heard of — exactly as a real reader does.
 *
 * @param {Record<string, string>} files - Path → body.
 * @returns {FileReaderPort} The reader.
 */
const reader = (files: Record<string, string> = {}): FileReaderPort => ({
  read: async (path: string) => {
    const body = files[path];
    if (body === undefined) {
      throw new Error(`no such file: ${path}`);
    }
    return body;
  },
});

/**
 * A three-member plan; overrides bend one axis.
 *
 * @param {Partial<SwarmPlan<{ n: number }>>} over - Plan overrides.
 * @returns {SwarmPlan<{ n: number }>} A plan.
 */
const plan = (
  over: Partial<SwarmPlan<{ n: number }>> = {},
): SwarmPlan<{ n: number }> => ({
  name: 'demo',
  role: 'edit.apply',
  args: { n: 3 },
  members: (a) => a.n,
  brief: (_a, m) => `brief-${m}`,
  key: (_a, m) => `k${m}`,
  ...over,
});

describe('dispatchSwarm', () => {
  it('refuses release when the doctor fails, running nothing', async () => {
    const res = await dispatchSwarm(plan({ members: 0 }), { registry: registry(), files: reader() });
    expect(res.released).toBe(false);
    expect(res.outcomes).toEqual([]);
    expect(res.findings[0]).toMatchObject({ check: 'count', ok: false });
  });

  it('dispatches every member through the model when clean', async () => {
    const res = await dispatchSwarm(plan(), { registry: registry(), files: reader() });
    expect(res.released).toBe(true);
    expect(res.outcomes.map((o) => o.state)).toEqual(['done', 'done', 'done']);
    expect(res.outcomes.map((o) => o.content)).toEqual([
      'ran:brief-0',
      'ran:brief-1',
      'ran:brief-2',
    ]);
  });

  it('honours the skip predicate without a model call', async () => {
    const res = await dispatchSwarm(plan(), {
      registry: registry(),
      files: reader(),
      skip: async (_p, m) => m === 1,
    });
    expect(res.outcomes.map((o) => o.state)).toEqual(['done', 'skipped', 'done']);
    expect(res.outcomes[1].content).toBeUndefined();
  });

  it('resumes by skipping members whose key already completed', async () => {
    const done = new Set(['k0']);
    const res = await dispatchSwarm(plan(), {
      registry: registry(),
      files: reader(),
      alreadyDone: (key) => done.has(key),
    });
    expect(res.outcomes.map((o) => o.state)).toEqual(['skipped', 'done', 'done']);
  });

  it('attaches the declared context files to the prompt, bodies and all', async () => {
    const res = await dispatchSwarm(
      plan({ contextFiles: (_a, m) => (m === 0 ? ['docs/style.md', 'src/a.ts'] : []) }),
      { registry: registry(), files: reader({ 'docs/style.md': 'be terse', 'src/a.ts': 'export {}' }) },
    );
    const first = res.outcomes[0].content ?? '';
    expect(first).toContain('brief-0');
    expect(first).toContain('## Attached context');
    expect(first).toContain('### docs/style.md');
    expect(first).toContain('be terse');
    expect(first).toContain('### src/a.ts');
    expect(first).toContain('export {}');
  });

  it('leaves a brief untouched when the member attaches nothing', async () => {
    const res = await dispatchSwarm(plan({ contextFiles: () => [] }), {
      registry: registry(),
      files: reader(),
    });
    expect(res.outcomes.map((o) => o.content)).toEqual([
      'ran:brief-0',
      'ran:brief-1',
      'ran:brief-2',
    ]);
  });

  it('reads a member’s context only for the member that declared it', async () => {
    const seen: string[] = [];
    const spy: FileReaderPort = {
      read: async (path) => {
        seen.push(path);
        return 'body';
      },
    };
    await dispatchSwarm(plan({ contextFiles: (_a, m) => [`m${m}.md`] }), {
      registry: registry(),
      files: spy,
    });
    expect(seen).toEqual(['m0.md', 'm1.md', 'm2.md']);
  });

  it('does not read context for a member the plan skips', async () => {
    const seen: string[] = [];
    const spy: FileReaderPort = {
      read: async (path) => {
        seen.push(path);
        return 'body';
      },
    };
    await dispatchSwarm(plan({ contextFiles: (_a, m) => [`m${m}.md`] }), {
      registry: registry(),
      files: spy,
      skip: (_p, m) => m !== 1,
    });
    expect(seen).toEqual(['m1.md']);
  });

  it('fails the run loudly when a context file cannot be read', async () => {
    await expect(
      dispatchSwarm(plan({ contextFiles: () => ['missing.md'] }), {
        registry: registry(),
        files: reader(),
      }),
    ).rejects.toThrow('no such file: missing.md');
  });

  it('throws loudly when the role resolves to no model', async () => {
    const optionalRole: RoleDeclaration = { ...editRole, optional: true };
    const reg: RoleRegistry = {
      declarations: new Map([[optionalRole.id, optionalRole]]),
      bindings: new Map(),
    };
    await expect(dispatchSwarm(plan(), { registry: reg, files: reader() })).rejects.toThrow(
      /resolved to no model/,
    );
  });
});

describe('dispatchSwarm progress', () => {
  it('announces every member starting and settling, in order, when sequential', async () => {
    const events: DispatchEvent[] = [];
    await dispatchSwarm(plan({ args: { n: 2 } }), {
      registry: registry(),
      files: reader(),
      concurrency: 1,
      onProgress: (event) => {
        events.push(event);
      },
    });

    expect(events.map((e) => `${e.phase}:${e.member}`)).toEqual([
      'started:0',
      'settled:0',
      'started:1',
      'settled:1',
    ]);
    expect(events.every((e) => e.total === 2)).toBe(true);
    expect(events.map((e) => e.key)).toEqual(['k0', 'k0', 'k1', 'k1']);
  });

  it('announces every member once each way under batching, its own start first', async () => {
    const events: DispatchEvent[] = [];
    await dispatchSwarm(plan({ args: { n: 4 } }), {
      registry: registry(),
      files: reader(),
      onProgress: (event) => {
        events.push(event);
      },
    });

    const seq = events.map((e) => `${e.phase}:${e.member}`);
    for (let member = 0; member < 4; member += 1) {
      expect(seq.indexOf(`started:${member}`)).toBeGreaterThanOrEqual(0);
      expect(seq.indexOf(`settled:${member}`)).toBeGreaterThan(
        seq.indexOf(`started:${member}`),
      );
    }
    expect(seq).toHaveLength(8);
    expect(events.every((e) => e.total === 4)).toBe(true);
  });

  it('carries the same outcome it puts in the result', async () => {
    const events: DispatchEvent[] = [];
    const res = await dispatchSwarm(plan({ args: { n: 2 } }), {
      registry: registry(),
      files: reader(),
      onProgress: (event) => {
        events.push(event);
      },
    });

    // The live view and the returned result come from one place, so a console
    // watching a run cannot end up disagreeing with the run's own answer.
    expect(events.filter((e) => e.phase === 'settled').map((e) => e.outcome)).toEqual(res.outcomes);
  });

  it('announces a skipped member as settled, without calling the model', async () => {
    const events: DispatchEvent[] = [];
    const res = await dispatchSwarm(plan({ args: { n: 2 } }), {
      registry: registry(),
      files: reader(),
      concurrency: 1,
      skip: (_p, member) => member === 0,
      onProgress: (event) => {
        events.push(event);
      },
    });

    expect(events[0]).toMatchObject({ phase: 'started', member: 0 });
    expect(events[1]).toMatchObject({ phase: 'settled', member: 0 });
    expect(events[1].outcome?.state).toBe('skipped');
    expect(res.outcomes[0].state).toBe('skipped');
  });

  it('announces a resumed member as settled too', async () => {
    const events: DispatchEvent[] = [];
    await dispatchSwarm(plan({ args: { n: 1 } }), {
      registry: registry(),
      files: reader(),
      alreadyDone: () => true,
      onProgress: (event) => {
        events.push(event);
      },
    });

    expect(events.map((e) => e.phase)).toEqual(['started', 'settled']);
    expect(events[1].outcome?.state).toBe('skipped');
  });

  it('says nothing about a plan the doctor refused, because nothing ran', async () => {
    const events: DispatchEvent[] = [];
    const res = await dispatchSwarm(plan({ members: 0 }), {
      registry: registry(),
      files: reader(),
      onProgress: (event) => {
        events.push(event);
      },
    });

    expect(res.released).toBe(false);
    expect(events).toEqual([]);
  });

  it('runs identically for a caller that wants no progress at all', async () => {
    const watched = await dispatchSwarm(plan({ args: { n: 2 } }), {
      registry: registry(),
      files: reader(),
      onProgress: () => undefined,
    });
    const silent = await dispatchSwarm(plan({ args: { n: 2 } }), {
      registry: registry(),
      files: reader(),
    });
    expect(silent).toEqual(watched);
  });

  it('does not swallow a broken watcher, because a use-case cannot judge what that means', async () => {
    await expect(
      dispatchSwarm(plan({ args: { n: 1 } }), {
        registry: registry(),
        files: reader(),
        onProgress: () => {
          throw new Error('the console exploded');
        },
      }),
    ).rejects.toThrow('the console exploded');
  });
});

describe('dispatchSwarm output budget', () => {
  it('spends the bound model’s output ceiling, so long answers are not cut off', async () => {
    const seen: (number | undefined)[] = [];
    const capturing: ModelPort = {
      complete: async (req) => {
        seen.push(req.maxOutputTokens);
        return { content: 'x', inputTokens: 1, outputTokens: 1 };
      },
    };

    await dispatchSwarm(plan({ args: { n: 2 } }), {
      registry: registry({ port: capturing }),
      files: reader(),
    });

    expect(seen).toEqual([CAP.maxOutputTokens, CAP.maxOutputTokens]);
    expect(CAP.maxOutputTokens).toBeGreaterThan(512);
  });
});
