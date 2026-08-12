/**
 * Plans Client Tests
 *
 * @fileoverview Cover the plan-file write transport: create posts the name as
 * JSON, remove sends the plan in the query, success carries the daemon's plan
 * path, refusals carry the daemon's reason when the body is JSON and the
 * status when it is not.
 *
 * @module @paw/gui/test/unit/infrastructure/plansClient
 */

import { describe, expect, it, vi } from 'vitest';
import { PLANS_URL, createPlansClient } from '../../../src/infrastructure/plansClient.js';
import type { FetchLike, ResponseLike } from '../../../src/infrastructure/snapshotSource.js';

const jsonResponse = (status: number, body: unknown): ResponseLike => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const textResponse = (status: number): ResponseLike => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    throw new Error('not json');
  },
});

describe('createPlansClient', () => {
  it('creates by posting the name and returns the scaffolded path', async () => {
    const fetchFn = vi.fn<FetchLike>(async () =>
      jsonResponse(201, { ok: true, plan: 'plans/fresh.swarm.mjs' }),
    );
    const result = await createPlansClient(fetchFn).create('fresh');
    expect(result).toEqual({ ok: true, plan: 'plans/fresh.swarm.mjs' });
    expect(fetchFn).toHaveBeenCalledWith(PLANS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'fresh' }),
    });
  });

  it('removes by naming the plan in the query', async () => {
    const fetchFn = vi.fn<FetchLike>(async () =>
      jsonResponse(200, { ok: true, plan: 'plans/doomed.swarm.mjs' }),
    );
    const result = await createPlansClient(fetchFn).remove('plans/doomed.swarm.mjs');
    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(`${PLANS_URL}?plan=plans%2Fdoomed.swarm.mjs`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
    });
  });

  it('carries the daemon reason on a JSON refusal', async () => {
    const client = createPlansClient(async () =>
      jsonResponse(422, { ok: false, reason: 'plan already exists: plans/x.swarm.mjs' }),
    );
    expect(await client.create('x')).toEqual({
      ok: false,
      reason: 'plan already exists: plans/x.swarm.mjs',
    });
  });

  it('falls back to the status when the refusal body is not JSON or has no reason', async () => {
    expect(await createPlansClient(async () => textResponse(405)).create('x')).toEqual({
      ok: false,
      reason: 'HTTP 405',
    });
    expect(await createPlansClient(async () => jsonResponse(500, {})).remove('p.swarm.mjs')).toEqual(
      { ok: false, reason: 'HTTP 500' },
    );
  });

  it('takes a success without a JSON body or without a plan field', async () => {
    expect(await createPlansClient(async () => textResponse(200)).create('x')).toEqual({ ok: true });
    expect(await createPlansClient(async () => jsonResponse(200, {})).remove('p.swarm.mjs')).toEqual(
      { ok: true, plan: undefined },
    );
  });
});
