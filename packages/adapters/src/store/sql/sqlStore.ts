/**
 * PAW SQL Store Adapter
 *
 * @fileoverview {@link StorePort} and {@link ConfigPort} over any
 * {@link SqlDriver}, build on Kysely. SQL come from schema Kysely
 * check; both engines share one implementation. Same semantics as
 * {@link createMemoryStore}: session see own
 * rows plus project-scoped ones, resolution match scope exactly —
 * clear file in one session must not retire other session's row for it.
 *
 * Session scope use `where('session_id', 'is', null)` for project rows and
 * `= sessionId` for own; NULL-safe.
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

/** Selected violation row, before map back to domain shape. */
type ViolationRow = Pick<
  Database['violations'],
  'file_path' | 'rule' | 'message' | 'indirect_fix'
> & { id: number };

/** Columns violation query read. */
const VIOLATION_COLUMNS = ['id', 'file_path', 'rule', 'message', 'indirect_fix'] as const;

/**
 * Rebuild {@link Violation} from stored row, put `indirectFix` back to
 * boolean from integer SQLite store it as.
 *
 * @param {ViolationRow} row - Stored row.
 * @returns {Violation} Domain violation.
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
 * Create store backed by SQL engine. Schema apply on creation; fresh
 * database and existing one both ready to use on return.
 *
 * @param {SqlDriver} driver - Engine binding to execute against.
 * @returns {StorePort & ConfigPort} Store.
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
