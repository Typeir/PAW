/**
 * @fileoverview Cover {@link sync}: a first sync is full, a matching state gives a delta from its
 * cursor, `full`, a changed project, and a null cursor force a sweep, and every input refusal
 * stops before or after the pull as documented.
 *
 * @module @paw/openproject/test/unit/sync
 */

import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../../src/application/pull.js';
import { sync } from '../../src/application/sync.js';
import { serializeSyncState } from '../../src/domain/syncState.js';
import { collection, ENV_TEXT, workPackage } from './fixtures.js';

/**
 * A fetch serving one page and recording the `filters` of each request.
 *
 * @param {readonly unknown[]} elements - Elements of the page.
 * @returns {{ fetch: FetchLike; filters: unknown[] }} The fetch and the filters it received.
 */
function serving(elements: readonly unknown[]): { fetch: FetchLike; filters: unknown[] } {
  const filters: unknown[] = [];
  const fetch: FetchLike = async (url) => {
    filters.push(JSON.parse(new URL(url).searchParams.get('filters') as string));
    return { status: 200, text: async () => JSON.stringify(collection(elements)) };
  };
  return { fetch, filters };
}

const STATE = serializeSyncState({
  baseUrl: 'http://localhost:18080',
  project: 'paw-spike',
  cursor: '2026-10-28T14:00:00.000Z',
});

const DOCUMENT = JSON.stringify({ tasks: [{ id: 'op-5', title: 'Five', fields: {} }], edges: [] });

const DELTA_FILTER = [{ updatedAt: { operator: '<>d', values: ['2026-10-28T14:00:00.000Z', ''] } }];

describe('sync', () => {
  it('sweeps on a first sync and records instance, project, and cursor', async () => {
    const { fetch, filters } = serving([workPackage(1, 'One'), workPackage(2, 'Two', { parent: 1 }), { id: 'x' }]);
    const result = await sync({ env: ENV_TEXT, state: '', document: DOCUMENT, full: false, fetch });
    expect(filters).toEqual([[]]);
    expect(result).toMatchObject({ ok: true, mode: 'full', pulled: 2, removed: 1 });
    expect(result.ok && result.refusals).toHaveLength(1);
    expect(result.ok && JSON.parse(result.document)).toEqual({
      tasks: [
        expect.objectContaining({ id: 'op-1' }),
        expect.objectContaining({ id: 'op-2' }),
      ],
      edges: [['op-1', 'op-2']],
    });
    expect(result.ok && JSON.parse(result.state)).toEqual({
      baseUrl: 'http://localhost:18080',
      project: 'paw-spike',
      cursor: '2026-10-28T14:12:22.200Z',
    });
  });

  it('pulls a delta from the cursor of a matching state and removes nothing', async () => {
    const { fetch, filters } = serving([workPackage(6, 'Six')]);
    const result = await sync({ env: ENV_TEXT, state: STATE, document: DOCUMENT, full: false, fetch });
    expect(filters).toEqual([DELTA_FILTER]);
    expect(result).toMatchObject({ ok: true, mode: 'delta', pulled: 1, removed: 0 });
  });

  it('sweeps when asked, when the project changed, and when the cursor is null', async () => {
    const states = [
      STATE,
      serializeSyncState({ baseUrl: 'http://localhost:18080', project: 'other', cursor: '2026-10-28T14:00:00.000Z' }),
      serializeSyncState({ baseUrl: 'http://other:8080', project: 'paw-spike', cursor: '2026-10-28T14:00:00.000Z' }),
      serializeSyncState({ baseUrl: 'http://localhost:18080', project: 'paw-spike', cursor: null }),
    ];
    for (const [index, state] of states.entries()) {
      const { fetch, filters } = serving([]);
      const result = await sync({ env: ENV_TEXT, state, document: DOCUMENT, full: index === 0, fetch });
      expect(filters).toEqual([[]]);
      expect(result).toMatchObject({ ok: true, mode: 'full', pulled: 0, removed: 1 });
      expect(result.ok && JSON.parse(result.state).cursor).toBeNull();
    }
  });

  it('refuses a bad env or sidecar before any request', async () => {
    const { fetch, filters } = serving([]);
    expect(await sync({ env: 'KEY=k', state: '', document: '', full: false, fetch })).toMatchObject({ ok: false });
    expect(await sync({ env: ENV_TEXT, state: '{', document: '', full: false, fetch })).toMatchObject({ ok: false });
    expect(filters).toEqual([]);
  });

  it('refuses a document that is not a task document before any request', async () => {
    const { fetch, filters } = serving([]);
    expect(await sync({ env: ENV_TEXT, state: '', document: '[]', full: false, fetch })).toEqual({
      ok: false,
      reason: '.paw/tasks.json is not a JSON object',
    });
    expect(filters).toEqual([]);
  });

  it('passes a pull refusal through', async () => {
    const fetch: FetchLike = async () => ({ status: 401, text: async () => '{"message":"no"}' });
    expect(await sync({ env: ENV_TEXT, state: '', document: '', full: false, fetch })).toEqual({
      ok: false,
      reason: 'GET /api/v3/projects/paw-spike/work_packages page 1 returned 401: no',
    });
  });
});
