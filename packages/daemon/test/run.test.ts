/**
 * Run Reporting Tests
 *
 * @fileoverview What the console is told about a run: the token meter counts
 * what the port actually carried and lets a failure through, and a finished
 * dispatch maps to the herd exactly as core reported it — no member is invented,
 * and a refused plan reports an empty herd rather than a hopeful one.
 *
 * @module @paw/daemon/test/run
 */

import type { DispatchResult, ModelPort } from '@paw/core';
import { describe, expect, it } from 'vitest';
import { meterPort, toRunProgress } from '../src/run.js';

const inner: ModelPort = {
  complete: async (request) => ({
    content: `ran: ${request.prompt}`,
    inputTokens: request.prompt.length,
    outputTokens: 2,
  }),
};

describe('meterPort', () => {
  it('counts nothing before a call and totals every call after', async () => {
    const metered = meterPort(inner);
    expect(metered.usage()).toEqual({ spendUsd: 0, tokensIn: 0, tokensOut: 0 });

    await metered.port.complete({ model: 'm', prompt: 'abc' });
    await metered.port.complete({ model: 'm', prompt: 'de' });

    expect(metered.usage()).toEqual({ spendUsd: 0, tokensIn: 5, tokensOut: 4 });
  });

  it('passes the model’s answer through untouched', async () => {
    const metered = meterPort(inner);
    await expect(metered.port.complete({ model: 'm', prompt: 'hi' })).resolves.toMatchObject({
      content: 'ran: hi',
    });
  });

  it('lets a failed call through instead of counting it as free', async () => {
    const broken: ModelPort = {
      complete: async () => {
        throw new Error('provider down');
      },
    };
    const metered = meterPort(broken);
    await expect(metered.port.complete({ model: 'm', prompt: 'hi' })).rejects.toThrow(
      'provider down',
    );
    expect(metered.usage().tokensIn).toBe(0);
  });
});

describe('toRunProgress', () => {
  it('maps outcomes to the herd, counting done, skipped, and confirmed', () => {
    const result: DispatchResult = {
      released: true,
      findings: [],
      outcomes: [
        { member: 0, key: 'a.mdx', state: 'done', content: 'wrote a' },
        { member: 1, key: 'b.mdx', state: 'skipped' },
        { member: 2, key: 'c.mdx', state: 'done', content: 'wrote c' },
      ],
    };
    expect(toRunProgress(result, '15-40-02', '2026-08-05T15:40:02.000Z')).toEqual({
      id: '15-40-02',
      startedAt: '2026-08-05T15:40:02.000Z',
      skipped: 1,
      done: 2,
      running: 0,
      failed: 0,
      confirmed: 2,
      members: [
        { member: 0, key: 'a.mdx', state: 'done', level: null },
        { member: 1, key: 'b.mdx', state: 'skipped', level: null },
        { member: 2, key: 'c.mdx', state: 'done', level: null },
      ],
    });
  });

  it('reports an empty herd for a plan the doctor refused', () => {
    const refused: DispatchResult = {
      released: false,
      findings: [{ check: 'count', ok: false }],
      outcomes: [],
    };
    expect(toRunProgress(refused, 'r', 't')).toMatchObject({
      done: 0,
      skipped: 0,
      confirmed: 0,
      members: [],
    });
  });
});
