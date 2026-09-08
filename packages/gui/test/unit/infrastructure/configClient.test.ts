/**
 * Config Client Tests
 *
 * @fileoverview Transport for binding editor. Read models. Scream loud when read
 * fail. Write. Show every way write get refused — JSON reason from edit engine,
 * JSON body with no reason, plain-text refusal that no JSON at all.
 *
 * @module @paw/gui/test/unit/infrastructure/configClient
 */

import { describe, expect, it, vi } from 'vitest';
import {
  CONFIG_ROLES_URL,
  CONFIG_URL,
  MODULES_URL,
  PROVIDERS_URL,
  TASKS_URL,
  createConfigClient,
} from '../../../src/infrastructure/configClient.js';
import type { FetchLike, ResponseLike } from '../../../src/infrastructure/snapshotSource.js';

/** Fetch that answer with fixed response. */
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

  describe('bindings', () => {
    it('reads models and roles together, defaulting absent fields', async () => {
      const fetchFn = respond({
        ok: true,
        json: async () => ({ models: ['fast'], roles: { 'edit.apply': 'fast' } }),
      });
      await expect(createConfigClient(fetchFn).bindings()).resolves.toEqual({
        models: ['fast'],
        roles: { 'edit.apply': 'fast' },
      });
      await expect(
        createConfigClient(respond({ ok: true, json: async () => ({}) })).bindings(),
      ).resolves.toEqual({ models: [], roles: {} });
    });

    it('throws when the read fails', async () => {
      await expect(
        createConfigClient(respond({ ok: false, status: 502 })).bindings(),
      ).rejects.toThrow('responded 502');
    });
  });

  describe('providers', () => {
    it('reads the key-free roster', async () => {
      const fetchFn = respond({
        ok: true,
        json: async () => [{ name: 'deepseek', type: 'openai', baseUrl: 'https://x', keyChars: 5 }],
      });
      await expect(createConfigClient(fetchFn).providers()).resolves.toEqual([
        { name: 'deepseek', type: 'openai', baseUrl: 'https://x', keyChars: 5 },
      ]);
      expect(fetchFn).toHaveBeenCalledWith(PROVIDERS_URL);
    });

    it('throws when the read fails', async () => {
      await expect(
        createConfigClient(respond({ ok: false, status: 404 })).providers(),
      ).rejects.toThrow('responded 404');
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

  describe('modules', () => {
    it('reads the module roster', async () => {
      const roster = [{ id: 'paw-agile', enabled: true, resolved: true, requiredBy: ['taiga'] }];
      const fetchFn = respond({ ok: true, json: async () => roster });
      await expect(createConfigClient(fetchFn).modules()).resolves.toEqual(roster);
      expect(fetchFn).toHaveBeenCalledWith(MODULES_URL);
    });

    it('throws when the read fails', async () => {
      await expect(
        createConfigClient(respond({ ok: false, status: 404 })).modules(),
      ).rejects.toThrow('responded 404');
    });

    it('PUTs the id to enable and DELETEs it in the query to disable', async () => {
      const on = respond({ ok: true });
      await createConfigClient(on).setModule('paw-agile', true);
      expect(on).toHaveBeenCalledWith(MODULES_URL, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'paw-agile' }),
      });

      const off = respond({ ok: true });
      await createConfigClient(off).setModule('paw-agile', false);
      expect(off).toHaveBeenCalledWith(`${MODULES_URL}?id=paw-agile`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
      });
    });

    it('surfaces the daemon reason when a toggle is refused', async () => {
      const res = await createConfigClient(
        respond({
          ok: false,
          json: async () => ({ ok: false, reason: 'module "paw-agile" is required by enabled connectors: taiga' }),
        }),
      ).setModule('paw-agile', false);
      expect(res).toEqual({
        ok: false,
        reason: 'module "paw-agile" is required by enabled connectors: taiga',
      });
    });
  });

  describe('tasks', () => {
    it('reads the graph rows and refusals', async () => {
      const view = { rows: [{ id: 'a', depth: 0 }], refusals: ['cannot link'] };
      const fetchFn = respond({ ok: true, json: async () => view });
      await expect(createConfigClient(fetchFn).tasks()).resolves.toEqual(view);
      expect(fetchFn).toHaveBeenCalledWith(TASKS_URL);
    });

    it('throws when the read fails', async () => {
      await expect(
        createConfigClient(respond({ ok: false, status: 404 })).tasks(),
      ).rejects.toThrow('responded 404');
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
