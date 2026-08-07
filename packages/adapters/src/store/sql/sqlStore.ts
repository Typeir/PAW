/**
 * PAW SQL Store Adapter
 *
 * @fileoverview A {@link StorePort} and {@link ConfigPort} over any
 * {@link SqlDriver}, so both supported engines share one implementation and
 * cannot drift apart in behaviour. The semantics are the ones
 * {@link createMemoryStore} defines as canonical, restated in SQL: a session
 * sees its own rows plus the project-scoped ones, and resolution matches a
 * scope exactly rather than by that same visibility rule — clearing a file in
 * one session must not retire another session's row for it.
 *
 * `session_id IS ?` rather than `= ?` throughout: SQLite's `IS` compares NULL to
 * NULL as equal, which is what "project scope" means here, and what `=` would
 * silently get wrong.
 *
 * @module @paw/adapters/store/sql/sqlStore
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ConfigPort, StorePort, Violation } from '@paw/core';
import type { SqlDriver, SqlRow } from './driver.js';
import { STORE_SCHEMA_SQL } from './schema.js';

const SELECT_UNRESOLVED = `
SELECT id, file_path, rule, message, indirect_fix
FROM violations
WHERE resolved_at IS NULL AND (session_id IS ? OR session_id IS NULL)
ORDER BY id
`;

const INSERT_VIOLATION = `
INSERT INTO violations (file_path, rule, message, indirect_fix, session_id)
VALUES (?, ?, ?, ?, ?)
`;

const RESOLVE_FOR_FILE = `
UPDATE violations SET resolved_at = datetime('now')
WHERE resolved_at IS NULL AND file_path = ? AND session_id IS ?
`;

const SELECT_CONFIG = 'SELECT value FROM paw_config WHERE key = ?';

const UPSERT_CONFIG = `
INSERT INTO paw_config (key, value) VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
`;

/**
 * Rebuild a {@link Violation} from its stored row, restoring `indirectFix` to a
 * boolean from the integer SQLite stores it as.
 *
 * @param {SqlRow} row - The stored row.
 * @returns {Violation} The domain violation.
 */
function toViolation(row: SqlRow): Violation {
  return {
    id: Number(row.id),
    filePath: String(row.file_path),
    rule: String(row.rule),
    message: String(row.message),
    indirectFix: Number(row.indirect_fix) !== 0,
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

  return {
    async unresolvedFor(sessionId: string | null): Promise<Violation[]> {
      return driver.all(SELECT_UNRESOLVED, [sessionId]).map(toViolation);
    },

    async raise(
      violations: readonly Violation[],
      sessionId: string | null,
    ): Promise<void> {
      for (const violation of violations) {
        driver.run(INSERT_VIOLATION, [
          violation.filePath,
          violation.rule,
          violation.message,
          violation.indirectFix ? 1 : 0,
          sessionId,
        ]);
      }
    },

    async resolveForFile(
      filePath: string,
      sessionId: string | null,
    ): Promise<number> {
      return driver.run(RESOLVE_FOR_FILE, [filePath, sessionId]);
    },

    async getConfig(key: string): Promise<string | null> {
      const rows = driver.all(SELECT_CONFIG, [key]);
      return rows.length === 0 ? null : String(rows[0].value);
    },

    async setConfig(key: string, value: string): Promise<void> {
      driver.run(UPSERT_CONFIG, [key, value]);
    },
  };
}
