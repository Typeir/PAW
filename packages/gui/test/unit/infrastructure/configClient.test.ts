/**
 * Config Client Tests
 *
 * @fileoverview The binding editor's transport: reading the models and the loud
 * failure when the read fails; the writes and every way a write can be refused —
 * a JSON reason from the edit engine, a JSON body with no reason, and a plain-text
 * transport refusal that is not JSON at all.
 *
 * @module @paw/gui/test/unit/infrastructure/configClient
 */

import { describe, expect, it, vi } from 'vitest';
import {
  CONFIG_ROLES_URL,
  CONFIG_URL,
  createConfigClient,
} from '../../../src/infrastructure/configClient.js';
import type { FetchLike, ResponseLike } from '../../../src/infrastructure/snapshotSource.js';

/** A fetch that answers with a fixed response. */
const respond = (response: Partial<ResponseLike> & { ok: boolean }): FetchLike =>
  vi.fn(async () => ({ status: response.ok ? 200 : 422, json: async () => ({}), ...response }));

describe('createConfigClient', () => {
  describe('models', () => {
    it('reads the declared model ids', async () => {
      const fetchFn = respond({ ok: true, json: async () => ({ models: ['fast', 'slow'], roles: {} }) });
      await expect(createConfigClient(fetchFn).models()).resolves.toEqual(['fast', 'slow']);
      expect(fetchFn).toHaveBeenCalledWith(CONFIG_URL);
    });

    it('reads an absent models field as empty', async () => {
      await expect(createConfigClient(respond({ ok: true, json: async () => ({}) })).models()).resolves.toEqual([]);
    });

    it('throws when the read fails', async () => {
      await expect(
        createConfigClient(respond({ ok: false, status: 500 })).models(),
      ).rejects.toThrow('responded 500');
    });
  });

  describe('bind', () => {
    it('PUTs the role and model and reports success', async () => {
      const fetchFn = respond({ ok: true });
      const res = await createConfigClient(fetchFn).bind('edit.apply', 'fast');
      expect(res).toEqual({ ok: true });
      expect(fetchFn).toHaveBeenCalledWith(CONFIG_ROLES_URL, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'edit.apply', model: 'fast' }),
      });
    });

    it('surfaces a JSON refusal reason from the edit engine', async () => {
      const res = await createConfigClient(
        respond({ ok: false, json: async () => ({ ok: false, reason: 'model "ghost" is not declared' }) }),
      ).bind('edit.apply', 'ghost');
      expect(res).toEqual({ ok: false, reason: 'model "ghost" is not declared' });
    });

    it('falls back to the status when a JSON refusal carries no reason', async () => {
      const res = await createConfigClient(
        respond({ ok: false, status: 422, json: async () => ({ ok: false }) }),
      ).bind('edit.apply', 'fast');
      expect(res).toEqual({ ok: false, reason: 'HTTP 422' });
    });

    it('falls back to the status when the refusal is plain text, not JSON', async () => {
      const res = await createConfigClient(
        respond({
          ok: false,
          status: 405,
          json: async () => {
            throw new SyntaxError('Unexpected token');
          },
        }),
      ).bind('edit.apply', 'fast');
      expect(res).toEqual({ ok: false, reason: 'HTTP 405' });
    });
  });

  describe('unbind', () => {
    it('DELETEs the role, escaping it in the query', async () => {
      const fetchFn = respond({ ok: true });
      await createConfigClient(fetchFn).unbind('review.judge');
      expect(fetchFn).toHaveBeenCalledWith(`${CONFIG_ROLES_URL}?role=review.judge`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
      });
    });
  });
});
