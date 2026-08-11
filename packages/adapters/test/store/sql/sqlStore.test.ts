/**
 * PAW SQL Store Tests
 *
 * @fileoverview Drive SQL-back {@link StorePort} against real engine
 * (sql.js, in memory). Assert semantics {@link createMemoryStore} define as
 * reference: session-scoped rows plus project-scoped rows visible to everyone,
 * resolution scoped exact. Run same suite against every driver in
 * `DRIVERS`.
 *
 * @module @paw/adapters/test/store/sql/sqlStore
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { Violation } from '@paw/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../../src/store/memoryStore.js';
import type { SqlDriver } from '../../../src/store/sql/driver.js';
import { createSqlStore } from '../../../src/store/sql/sqlStore.js';
import { openSqlJsMemoryDriver } from './helpers.js';

/**
 * Build violation with default field values.
 *
 * @param {Partial<Violation>} over - Fields to override.
 * @returns {Violation} The violation.
 */
function v(over: Partial<Violation> = {}): Violation {
  return {
    id: 0,
    filePath: 'src/a.ts',
    rule: 'no-any',
    message: 'no any',
    indirectFix: false,
    ...over,
  };
}

const DRIVERS: readonly [string, () => Promise<SqlDriver>][] = [
  ['sql.js', openSqlJsMemoryDriver],
];

describe.each(DRIVERS)('createSqlStore over %s', (_name, open) => {
  let driver: SqlDriver;
  let store: ReturnType<typeof createSqlStore>;

  beforeEach(async () => {
    driver = await open();
    store = createSqlStore(driver);
  });

  it('returns nothing before anything is raised', async () => {
    expect(await store.unresolvedFor('sess-1')).toEqual([]);
  });

  it('round-trips a raised violation with a store-assigned id', async () => {
    await store.raise([v({ message: 'first' })], 'sess-1');
    const rows = await store.unresolvedFor('sess-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe('first');
    expect(rows[0].filePath).toBe('src/a.ts');
    expect(rows[0].rule).toBe('no-any');
    expect(rows[0].indirectFix).toBe(false);
    expect(rows[0].id).toBeGreaterThan(0);
  });

  it('preserves indirectFix as a boolean, not the stored integer', async () => {
    await store.raise([v({ indirectFix: true })], 'sess-1');
    const [row] = await store.unresolvedFor('sess-1');
    expect(row.indirectFix).toBe(true);
  });

  it('assigns distinct ids across a multi-violation raise', async () => {
    await store.raise([v({ message: 'a' }), v({ message: 'b' })], 'sess-1');
    const rows = await store.unresolvedFor('sess-1');
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it('shows project-scoped rows to every session', async () => {
    await store.raise([v()], null);
    expect(await store.unresolvedFor('any-session')).toHaveLength(1);
    expect(await store.unresolvedFor(null)).toHaveLength(1);
  });

  it('hides one session’s rows from another', async () => {
    await store.raise([v()], 'sess-1');
    expect(await store.unresolvedFor('sess-2')).toHaveLength(0);
  });

  it('resolves by file within a session and reports the count', async () => {
    await store.raise([v({ filePath: 'src/a.ts' }), v({ filePath: 'src/b.ts' })], 'sess-1');
    expect(await store.resolveForFile('src/a.ts', 'sess-1')).toBe(1);
    const rows = await store.unresolvedFor('sess-1');
    expect(rows.map((r) => r.filePath)).toEqual(['src/b.ts']);
  });

  it('does not resolve another session’s rows', async () => {
    await store.raise([v()], 'sess-1');
    expect(await store.resolveForFile('src/a.ts', 'sess-2')).toBe(0);
    expect(await store.unresolvedFor('sess-1')).toHaveLength(1);
  });

  it('does not resolve project-scoped rows from a session', async () => {
    await store.raise([v()], null);
    expect(await store.resolveForFile('src/a.ts', 'sess-1')).toBe(0);
    expect(await store.resolveForFile('src/a.ts', null)).toBe(1);
  });

  it('is idempotent on a second resolve', async () => {
    await store.raise([v()], 'sess-1');
    expect(await store.resolveForFile('src/a.ts', 'sess-1')).toBe(1);
    expect(await store.resolveForFile('src/a.ts', 'sess-1')).toBe(0);
  });

  it('lists outstanding rows across every session', async () => {
    await store.raise([v()], 'sess-1');
    await store.raise([v({ filePath: 'src/b.ts' })], 'sess-2');
    await store.raise([v({ filePath: 'src/c.ts' })], null);
    expect((await store.outstanding()).map((r) => r.filePath)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('prunes one file across all sessions, then prunes the rest', async () => {
    await store.raise([v()], 'sess-1');
    await store.raise([v()], 'sess-2');
    await store.raise([v({ filePath: 'src/b.ts' })], null);
    expect(await store.prune('src/a.ts')).toBe(2);
    expect((await store.outstanding()).map((r) => r.filePath)).toEqual(['src/b.ts']);
    expect(await store.prune(null)).toBe(1);
    expect(await store.outstanding()).toEqual([]);
  });

  it('reads back config it wrote', async () => {
    await store.setConfig('paw.enabled', 'false');
    expect(await store.getConfig('paw.enabled')).toBe('false');
  });

  it('returns null for config that was never set', async () => {
    expect(await store.getConfig('missing')).toBeNull();
  });

  it('overwrites config on a second set', async () => {
    await store.setConfig('paw.enabled', 'false');
    await store.setConfig('paw.enabled', 'true');
    expect(await store.getConfig('paw.enabled')).toBe('true');
  });

  it('survives reopening over the same driver', async () => {
    await store.raise([v()], 'sess-1');
    const reopened = createSqlStore(driver);
    expect(await reopened.unresolvedFor('sess-1')).toHaveLength(1);
  });
});

describe('parity with the in-memory reference store', () => {
  it('agrees with createMemoryStore on scope visibility', async () => {
    const driver = await openSqlJsMemoryDriver();
    const sql = createSqlStore(driver);
    const mem = createMemoryStore();

    for (const store of [sql, mem]) {
      await store.raise([v({ message: 'session' })], 'sess-1');
      await store.raise([v({ message: 'project' })], null);
    }

    const sqlRows = (await sql.unresolvedFor('sess-1')).map((r) => r.message);
    const memRows = (await mem.unresolvedFor('sess-1')).map((r) => r.message);
    expect(sqlRows).toEqual(memRows);

    expect(await sql.resolveForFile('src/a.ts', 'sess-1')).toBe(
      await mem.resolveForFile('src/a.ts', 'sess-1'),
    );
  });
});
