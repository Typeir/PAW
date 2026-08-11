/**
 * Recent Routes Client Tests
 *
 * @fileoverview Read transport of scope picker. Bring recently-grabbed routes.
 * Throw on failed read. Make `recentClient.ts` hit 100%.
 *
 * @module @paw/gui/test/unit/infrastructure/recentClient
 */

import { describe, expect, it, vi } from 'vitest';
import { RECENT_URL, createRecentClient } from '../../../src/infrastructure/recentClient.js';
import type { FetchLike, ResponseLike } from '../../../src/infrastructure/snapshotSource.js';

/** Fetch answer with fixed response. */
const respond = (response: Partial<ResponseLike> & { ok: boolean }): FetchLike =>
  vi.fn(async () => ({ status: response.ok ? 200 : 500, json: async () => [], ...response }));

describe('createRecentClient', () => {
  it('reads the recently-grabbed routes', async () => {
    const fetchFn = respond({ ok: true, json: async () => ['/repo/a', '/repo/b'] });
    await expect(createRecentClient(fetchFn).list()).resolves.toEqual(['/repo/a', '/repo/b']);
    expect(fetchFn).toHaveBeenCalledWith(RECENT_URL);
  });

  it('throws when the read fails', async () => {
    await expect(createRecentClient(respond({ ok: false, status: 503 })).list()).rejects.toThrow(
      'responded 503',
    );
  });

  it('forgets a route over DELETE, url-encoding it, and returns the new list', async () => {
    const fetchFn = respond({ ok: true, json: async () => ['/repo/b'] });
    await expect(createRecentClient(fetchFn).remove('/repo/a b')).resolves.toEqual(['/repo/b']);
    expect(fetchFn).toHaveBeenCalledWith(`${RECENT_URL}?route=${encodeURIComponent('/repo/a b')}`, {
      method: 'DELETE',
    });
  });

  it('throws when the forget fails', async () => {
    await expect(
      createRecentClient(respond({ ok: false, status: 500 })).remove('/repo/a'),
    ).rejects.toThrow('responded 500');
  });
});
