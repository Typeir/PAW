/**
 * @fileoverview Cover {@link pullWorkPackages} through a fake fetch: the request it builds, full
 * and delta filters, paging to `total` and stopping on an empty page, the cursor, element
 * refusals, and the refusals for a failed request, an HTTP error, and a body that is not a
 * collection.
 *
 * @module @paw/openproject/test/unit/pull
 */

import { describe, expect, it } from 'vitest';
import { pullWorkPackages, type FetchLike, type FetchResponse } from '../../src/application/pull.js';
import type { BackendConfig } from '../../src/domain/backendEnv.js';
import { collection, workPackage } from './fixtures.js';

const CONFIG: BackendConfig = { baseUrl: 'http://localhost:18080', key: 'test-key', project: 'paw spike' };

/**
 * One request the fake fetch received.
 *
 * @interface Call
 * @property {URL} url - Parsed request URL.
 * @property {Readonly<Record<string, string>>} headers - Request headers.
 */
interface Call {
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * A fake fetch answering each call with the next response.
 *
 * @param {ReadonlyArray<FetchResponse | Error>} responses - Answers in call order; an Error rejects.
 * @returns {{ fetch: FetchLike; calls: Call[] }} The fetch and the calls it received.
 */
function fakeFetch(responses: ReadonlyArray<FetchResponse | Error>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url: new URL(url), headers: init.headers });
    const next = responses[calls.length - 1];
    if (next === undefined) {
      throw new Error(`unexpected call ${calls.length}: ${url}`);
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
  return { fetch, calls };
}

/**
 * A response with a JSON body.
 *
 * @param {unknown} body - Body value.
 * @param {number} [status] - HTTP status; default 200.
 * @returns {FetchResponse} The response.
 */
function json(body: unknown, status = 200): FetchResponse {
  return { status, text: async () => JSON.stringify(body) };
}

describe('pullWorkPackages', () => {
  it('requests the project subtree with no filter, page 1, by id, with apikey basic auth', async () => {
    const { fetch, calls } = fakeFetch([json(collection([workPackage(1, 'One')]))]);
    const pulled = await pullWorkPackages(fetch, CONFIG, null);
    expect(pulled).toMatchObject({ ok: true, refusals: [], cursor: '2026-10-28T14:12:22.200Z' });
    expect(pulled.ok && pulled.records.map((r) => r.id)).toEqual(['op-1']);
    const [call] = calls as [Call];
    expect(call.url.origin + call.url.pathname).toBe('http://localhost:18080/api/v3/projects/paw%20spike/work_packages');
    expect(Object.fromEntries(call.url.searchParams)).toEqual({
      filters: '[]',
      pageSize: '100',
      offset: '1',
      sortBy: '[["id","asc"]]',
    });
    expect(call.headers).toEqual({
      Accept: 'application/hal+json',
      Authorization: `Basic ${btoa('apikey:test-key')}`,
    });
  });

  it('filters on updatedAt from the cursor and keeps the cursor when nothing changed', async () => {
    const { fetch, calls } = fakeFetch([json(collection([]))]);
    const pulled = await pullWorkPackages(fetch, CONFIG, '2026-10-28T14:00:00.000Z');
    expect(pulled).toEqual({ ok: true, records: [], refusals: [], cursor: '2026-10-28T14:00:00.000Z' });
    expect(JSON.parse((calls[0] as Call).url.searchParams.get('filters') as string)).toEqual([
      { updatedAt: { operator: '<>d', values: ['2026-10-28T14:00:00.000Z', ''] } },
    ]);
  });

  it('pages until total, takes the newest updatedAt as cursor, and refuses unmappable elements', async () => {
    const { fetch, calls } = fakeFetch([
      json(collection([workPackage(1, 'One', { updatedAt: '2026-10-28T14:00:00.5Z' }), { id: 'x' }], 3, 1, 2)),
      json(collection([workPackage(2, 'Two', { updatedAt: '2026-10-28T14:00:00.250Z' })], 3, 2, 2)),
    ]);
    const pulled = await pullWorkPackages(fetch, CONFIG, null);
    expect(calls.map((call) => call.url.searchParams.get('offset'))).toEqual(['1', '2']);
    expect(pulled).toMatchObject({ ok: true, cursor: '2026-10-28T14:00:00.5Z' });
    expect(pulled.ok && pulled.records.map((r) => r.id)).toEqual(['op-1', 'op-2']);
    expect(pulled.ok && pulled.refusals).toEqual([
      'work package without a numeric id, subject, and updatedAt: {"id":"x"}',
    ]);
  });

  it('stops on an empty page even when total says more', async () => {
    const { fetch, calls } = fakeFetch([json(collection([workPackage(1, 'One')], 5)), json(collection([], 5, 2))]);
    const pulled = await pullWorkPackages(fetch, CONFIG, null);
    expect(calls).toHaveLength(2);
    expect(pulled.ok && pulled.records).toHaveLength(1);
  });

  it('refuses a request that fails, naming the path', async () => {
    const { fetch } = fakeFetch([new Error('connect ECONNREFUSED')]);
    expect(await pullWorkPackages(fetch, CONFIG, null)).toEqual({
      ok: false,
      reason: 'GET /api/v3/projects/paw%20spike/work_packages page 1 failed: Error: connect ECONNREFUSED',
    });
  });

  it('refuses an HTTP error with the server message, or the raw body when it has none', async () => {
    const unauthorized = json({ _type: 'Error', message: 'You did not provide the correct credentials.' }, 401);
    expect(await pullWorkPackages(fakeFetch([unauthorized]).fetch, CONFIG, null)).toEqual({
      ok: false,
      reason:
        'GET /api/v3/projects/paw%20spike/work_packages page 1 returned 401: You did not provide the correct credentials.',
    });
    const gateway: FetchResponse = { status: 502, text: async () => '<html>Bad Gateway</html>' };
    expect(await pullWorkPackages(fakeFetch([gateway]).fetch, CONFIG, null)).toEqual({
      ok: false,
      reason: 'GET /api/v3/projects/paw%20spike/work_packages page 1 returned 502: <html>Bad Gateway</html>',
    });
    const bare = json({ _type: 'Error' }, 500);
    expect(await pullWorkPackages(fakeFetch([bare]).fetch, CONFIG, null)).toEqual({
      ok: false,
      reason: 'GET /api/v3/projects/paw%20spike/work_packages page 1 returned 500: {"_type":"Error"}',
    });
  });

  it('refuses a body that is not a work package collection', async () => {
    for (const body of ['not json', JSON.stringify({ total: 1 }), JSON.stringify({ _embedded: { elements: [] } }), 'null']) {
      const response: FetchResponse = { status: 200, text: async () => body };
      expect(await pullWorkPackages(fakeFetch([response]).fetch, CONFIG, null)).toEqual({
        ok: false,
        reason: 'GET /api/v3/projects/paw%20spike/work_packages page 1 returned no work package collection',
      });
    }
  });
});
