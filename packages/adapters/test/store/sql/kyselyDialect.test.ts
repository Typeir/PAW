/**
 * PAW Kysely dialect test.
 *
 * @fileoverview Exercise dialect that run Kysely over PAW's `SqlDriver`
 * beyond what store own queries reach: committed and rolled-back
 * transaction (begin/commit/rollback over single connection), introspection
 * (SQLite introspector read through select path), refusal to
 * stream, and destroy. Cover `kyselyDialect.ts` to 100%.
 *
 * @module @paw/adapters/test/store/sql/kyselyDialect
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { createKysely } from '../../../src/store/sql/kyselyDialect.js';
import { STORE_SCHEMA_SQL } from '../../../src/store/sql/schema.js';
import { openSqlJsMemoryDriver } from './helpers.js';

/** Kysely over fresh in-memory engine with schema applied. */
async function freshDb(): Promise<ReturnType<typeof createKysely>> {
  const driver = await openSqlJsMemoryDriver();
  driver.exec(STORE_SCHEMA_SQL);
  return createKysely(driver);
}

// row data for insert.
const row = { file_path: 'src/a.ts', rule: 'r', message: 'm', indirect_fix: 0, session_id: null };

describe('sqlDriverDialect', () => {
  it('commits a transaction', async () => {
    const db = await freshDb();
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('violations').values(row).execute();
    });
    expect(await db.selectFrom('violations').selectAll().execute()).toHaveLength(1);
  });

  it('rolls back a failing transaction', async () => {
    const db = await freshDb();
    await expect(
      db.transaction().execute(async (trx) => {
        await trx.insertInto('violations').values(row).execute();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.selectFrom('violations').selectAll().execute()).toHaveLength(0);
  });

  it('introspects the tables through the select path', async () => {
    const db = await freshDb();
    const names = (await db.introspection.getTables()).map((t) => t.name);
    expect(names).toContain('violations');
    expect(names).toContain('paw_config');
  });

  it('refuses to stream', async () => {
    const db = await freshDb();
    await expect(
      (async () => {
        for await (const _ of db.selectFrom('violations').selectAll().stream()) {
          void _;
        }
      })(),
    ).rejects.toThrow('streaming');
  });

  it('destroys without error', async () => {
    const db = await freshDb();
    await db.selectFrom('violations').selectAll().execute();
    await expect(db.destroy()).resolves.toBeUndefined();
  });
});
