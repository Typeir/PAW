/**
 * PAW In-Memory Store Tests
 *
 * @fileoverview Covers raising violations, session vs project scope visibility,
 * resolution by file within a session and at project scope, and the id
 * assignment — so `memoryStore.ts` reaches 100%.
 *
 * @module @paw/adapters/test/store/memoryStore
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import type { Violation } from '@paw/core';
import { createMemoryStore } from '../../src/store/memoryStore.js';

const v = (over: Partial<Violation> = {}): Violation => ({
  id: 0,
  filePath: 'src/a.ts',
  rule: 'jsdoc',
  message: 'missing',
  indirectFix: false,
  ...over,
});

describe('createMemoryStore', () => {
  it('returns session-scoped violations and assigns ids', async () => {
    const store = createMemoryStore();
    await store.raise([v(), v({ filePath: 'src/b.ts' })], 'sess-1');

    const rows = await store.unresolvedFor('sess-1');
    expect(rows.map((r) => r.filePath)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });

  it('makes project-scoped violations visible to every session', async () => {
    const store = createMemoryStore();
    await store.raise([v()], null);
    expect((await store.unresolvedFor('any-session')).length).toBe(1);
    expect((await store.unresolvedFor(null)).length).toBe(1);
  });

  it('hides another session’s violations', async () => {
    const store = createMemoryStore();
    await store.raise([v()], 'sess-1');
    expect((await store.unresolvedFor('sess-2')).length).toBe(0);
  });

  it('resolves a file within a session and reports the count', async () => {
    const store = createMemoryStore();
    await store.raise([v(), v({ filePath: 'src/b.ts' })], 'sess-1');
    expect(await store.resolveForFile('src/a.ts', 'sess-1')).toBe(1);
    const rows = await store.unresolvedFor('sess-1');
    expect(rows.map((r) => r.filePath)).toEqual(['src/b.ts']);
  });

  it('resolves project-scoped violations when asked with a null session', async () => {
    const store = createMemoryStore();
    await store.raise([v()], null);
    await store.raise([v()], 'sess-1');
    expect(await store.resolveForFile('src/a.ts', null)).toBe(1);
    expect((await store.unresolvedFor('sess-1')).length).toBe(1);
  });
});
