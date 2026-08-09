/**
 * PAW SQL Store Adapter
 *
 * @fileoverview A {@link StorePort} and {@link ConfigPort} over any
 * {@link SqlDriver}, built on Kysely — the typed query builder is the store's
 * default interface now, so the SQL is generated from a schema Kysely checks
 * rather than hand-written strings, and both supported engines still share one
 * implementation and cannot drift. The semantics are the ones
 * {@link createMemoryStore} defines as canonical: a session sees its own rows
 * plus the project-scoped ones, and resolution matches a scope exactly rather
 * than by that same visibility rule — clearing a file in one session must not
 * retire another session's row for it.
 *
 * Session scope is expressed as `where('session_id', 'is', null)` for the
 * project rows and `= sessionId` for a session's own — NULL-safe by construction,
 * where the raw form needed `IS ?` to avoid `= NULL` silently matching nothing.
 *
 * @module @paw/adapters/store/sql/sqlStore
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ConfigPort, StorePort, Violation } from '@paw/core';
import { sql } from 'kysely';
import type { SqlDriver } from './driver.js';
import { createKysely, type Database } from './kyselyDialect.js';
import { STORE_SCHEMA_SQL } from './schema.js';

/** A selected violation row, before it is mapped back to the domain shape. */
type ViolationRow = Pick<
  Database['violations'],
  'file_path' | 'rule' | 'message' | 'indirect_fix'
> & { id: number };

/** The columns a violation query reads. */
const VIOLATION_COLUMNS = ['id', 'file_path', 'rule', 'message', 'indirect_fix'] as const;

/**
 * Rebuild a {@link Violation} from its stored row, restoring `indirectFix` to a
 * boolean from the integer SQLite stores it as.
 *
 * @param {ViolationRow} row - The stored row.
 * @returns {Violation} The domain violation.
 */
function toViolation(row: ViolationRow): Violation {
  return {
    id: Number(row.id),
    filePath: row.file_path,
    rule: row.rule,
    message: row.message,
    indirectFix: row.indirect_fix !== 0,
  };
}

/**
 * Create a store backed by a SQL engine. The schema is applied on creation, so
 * a fresh database and an existing one are both ready to use on return.
 *
 * @param {SqlDriver} driver - The engine binding to execute against.
 * @returns {StorePort & ConfigPort} The store.
 */
export function createSqlStore(driver: SqlDriver): StorePort & ConfigPort {
  driver.exec(STORE_SCHEMA_SQL);
  const db = createKysely(driver);
  const now = sql<string>`datetime('now')`;

  return {
    async unresolvedFor(sessionId: string | null): Promise<Violation[]> {
      const base = db
        .selectFrom('violations')
        .select(VIOLATION_COLUMNS)
        .where('resolved_at', 'is', null);
      const scoped =
        sessionId === null
          ? base.where('session_id', 'is', null)
          : base.where((eb) =>
              eb.or([eb('session_id', '=', sessionId), eb('session_id', 'is', null)]),
            );
      return (await scoped.orderBy('id').execute()).map(toViolation);
    },

    async raise(
      violations: readonly Violation[],
      sessionId: string | null,
    ): Promise<void> {
      for (const violation of violations) {
        await db
          .insertInto('violations')
          .values({
            file_path: violation.filePath,
            rule: violation.rule,
            message: violation.message,
            indirect_fix: violation.indirectFix ? 1 : 0,
            session_id: sessionId,
          })
          .execute();
      }
    },

    async resolveForFile(
      filePath: string,
      sessionId: string | null,
    ): Promise<number> {
      const base = db
        .updateTable('violations')
        .set({ resolved_at: now })
        .where('resolved_at', 'is', null)
        .where('file_path', '=', filePath);
      const scoped =
        sessionId === null
          ? base.where('session_id', 'is', null)
          : base.where('session_id', '=', sessionId);
      return Number((await scoped.executeTakeFirst()).numUpdatedRows);
    },

    async outstanding(): Promise<Violation[]> {
      const rows = await db
        .selectFrom('violations')
        .select(VIOLATION_COLUMNS)
        .where('resolved_at', 'is', null)
        .orderBy('id')
        .execute();
      return rows.map(toViolation);
    },

    async prune(filePath: string | null): Promise<number> {
      const base = db
        .updateTable('violations')
        .set({ resolved_at: now })
        .where('resolved_at', 'is', null);
      const scoped = filePath === null ? base : base.where('file_path', '=', filePath);
      return Number((await scoped.executeTakeFirst()).numUpdatedRows);
    },

    async getConfig(key: string): Promise<string | null> {
      const row = await db
        .selectFrom('paw_config')
        .select('value')
        .where('key', '=', key)
        .executeTakeFirst();
      return row === undefined ? null : row.value;
    },

    async setConfig(key: string, value: string): Promise<void> {
      await db
        .insertInto('paw_config')
        .values({ key, value })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: now }))
        .execute();
    },
  };
}
