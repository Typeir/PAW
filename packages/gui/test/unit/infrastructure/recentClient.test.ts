/**
 * Recent Routes Client Tests
 *
 * @fileoverview The scope picker's read transport: the recently-grabbed routes,
 * and the loud failure when the read fails. So `recentClient.ts` reaches 100%.
 *
 * @module @paw/gui/test/unit/infrastructure/recentClient
 */

import { describe, expect, it, vi } from 'vitest';
import { RECENT_URL, createRecentClient } from '../../../src/infrastructure/recentClient.js';
import type { FetchLike, ResponseLike } from '../../../src/infrastructure/snapshotSource.js';

/** A fetch that answers with a fixed response. */
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
});
