/**
 * PAW Config Control Port Tests
 *
 * @fileoverview Test each config verb against fake document. Bind write doc and
 * return new roles. Declare write new models. Clear take role from body or query.
 * Refusals cover non-string param, missing one, engine rejection, malformed caps.
 *
 * @module @paw/daemon/test/configControl
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import type { ConfigDocument, ConfigDocumentPort, ModelCapabilities } from '@paw/core';
import { configControl } from '../src/application/configControl.js';
import type { ControlRequest } from '../src/domain/control.js';

const caps: ModelCapabilities = {
  contextTokens: 200_000,
  maxOutputTokens: 32_000,
  tools: true,
  structuredOutput: true,
  reasoning: true,
  vision: false,
  costClass: 'standard',
};

/** In-memory doc port. Record each write. */
function fakeDoc(initial: ConfigDocument = {}): { port: ConfigDocumentPort; get: () => ConfigDocument } {
  let doc = initial;
  return {
    port: {
      read: async () => doc,
      write: async (next) => {
        doc = next;
      },
    },
    get: () => doc,
  };
}

const req = (over: Partial<ControlRequest> = {}): ControlRequest => ({
  query: undefined,
  body: {},
  ...over,
});

const withModel: ConfigDocument = { models: { fast: caps } };

describe('configControl', () => {
  describe('PUT /api/config/roles', () => {
    const run = (doc: ConfigDocumentPort, over: Partial<ControlRequest>) =>
      configControl(doc).handlers['PUT /api/config/roles'](req(over));

    it('binds a role, writes the document, and returns the new roles', async () => {
      const doc = fakeDoc(withModel);
      const res = await run(doc.port, { body: { role: 'review.judge', model: 'fast' } });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        roles: { 'review.judge': 'fast' },
        models: { fast: caps },
        connectors: [],
      });
      expect(doc.get().roles).toEqual({ 'review.judge': 'fast' });
    });

    it('refuses a non-string role or model with 422', async () => {
      const res = await run(fakeDoc(withModel).port, { body: { role: 1, model: 'fast' } });
      expect(res.status).toBe(422);
    });

    it('surfaces an engine refusal, e.g. an undeclared model', async () => {
      const res = await run(fakeDoc().port, { body: { role: 'review.judge', model: 'ghost' } });
      expect(res).toMatchObject({ status: 422, body: { ok: false } });
    });
  });

  describe('DELETE /api/config/roles', () => {
    const run = (doc: ConfigDocumentPort, over: Partial<ControlRequest>) =>
      configControl(doc).handlers['DELETE /api/config/roles'](req(over));

    it('clears a role named in the body', async () => {
      const doc = fakeDoc({ roles: { 'edit.apply': 'fast' } });
      const res = await run(doc.port, { body: { role: 'edit.apply' } });
      expect(res.status).toBe(200);
      expect(doc.get().roles).toEqual({});
    });

    it('clears a role named in the query', async () => {
      const doc = fakeDoc({ roles: { 'edit.apply': 'fast' } });
      const res = await run(doc.port, { query: new URLSearchParams('role=edit.apply') });
      expect(res.status).toBe(200);
      expect(doc.get().roles).toEqual({});
    });

    it('refuses when no role is given', async () => {
      expect((await run(fakeDoc().port, {})).status).toBe(422);
    });
  });

  describe('PUT /api/config/models', () => {
    const run = (doc: ConfigDocumentPort, over: Partial<ControlRequest>) =>
      configControl(doc).handlers['PUT /api/config/models'](req(over));

    it('declares a model, writes it, and returns the new models', async () => {
      const doc = fakeDoc();
      const res = await run(doc.port, { body: { id: 'slow', capabilities: { ...caps } } });
      expect(res.status).toBe(200);
      expect(doc.get().models).toEqual({ slow: caps });
    });

    it('refuses a non-string id', async () => {
      expect((await run(fakeDoc().port, { body: { capabilities: caps } })).status).toBe(422);
    });

    it('refuses malformed capabilities', async () => {
      const res = await run(fakeDoc().port, { body: { id: 'slow', capabilities: { tools: 'yes' } } });
      expect(res.status).toBe(422);
    });
  });

  describe('connector enable and disable', () => {
    const enable = (doc: ConfigDocumentPort, over: Partial<ControlRequest>) =>
      configControl(doc).handlers['PUT /api/connectors'](req(over));
    const disable = (doc: ConfigDocumentPort, over: Partial<ControlRequest>) =>
      configControl(doc).handlers['DELETE /api/connectors'](req(over));

    it('enables a connector, writes the document, and returns the enabled ids', async () => {
      const doc = fakeDoc();
      const res = await enable(doc.port, { body: { id: 'tsc' } });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, connectors: ['tsc'] });
      expect(doc.get().connectors).toEqual(['tsc']);
    });

    it('disables by body or by query', async () => {
      const doc = fakeDoc({ connectors: ['tsc', 'eslint'] });
      expect(await disable(doc.port, { body: { id: 'tsc' } })).toMatchObject({ status: 200 });
      expect(doc.get().connectors).toEqual(['eslint']);
      const byQuery = await disable(doc.port, { query: new URLSearchParams('id=eslint') });
      expect(byQuery).toMatchObject({ status: 200 });
      expect(doc.get().connectors).toEqual([]);
    });

    it('refuses an unknown id and a missing one', async () => {
      expect(await enable(fakeDoc().port, { body: { id: 'jenkins' } })).toMatchObject({ status: 422 });
      expect(await enable(fakeDoc().port, { body: {} })).toMatchObject({ status: 422 });
      expect(await disable(fakeDoc().port, { body: {} })).toMatchObject({ status: 422 });
    });
  });
});
