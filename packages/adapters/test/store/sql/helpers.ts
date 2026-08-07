/**
 * PAW SQL Store Test Helpers
 *
 * @fileoverview Opens real database engines in memory so the store suites run
 * against the SQL they will actually execute. `node:sqlite` is probed rather
 * than imported at module load, because the engine is absent or blocked on some
 * managed machines and its absence must skip a test rather than fail the file.
 *
 * @module @paw/adapters/test/store/sql/helpers
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { SqlDriver } from '../../../src/store/sql/driver.js';
import { createNodeSqliteDriver } from '../../../src/store/sql/nodeSqliteDriver.js';
import { createSqlJsDriver } from '../../../src/store/sql/sqlJsDriver.js';

/**
 * Open an in-memory sql.js driver. Persistence is discarded — the suite is
 * exercising SQL semantics, not the write-back path, which has its own test.
 *
 * @returns {Promise<SqlDriver>} A driver over a fresh in-memory database.
 */
export async function openSqlJsMemoryDriver(): Promise<SqlDriver> {
  const initSqlJs = (await import('sql.js')).default;
  const engine = await initSqlJs();
  return createSqlJsDriver(new engine.Database(), () => undefined);
}

/**
 * Open an in-memory `node:sqlite` driver, or null when the engine is
 * unavailable on this machine.
 *
 * @returns {Promise<SqlDriver | null>} A driver, or null when unavailable.
 */
export async function openNodeSqliteMemoryDriver(): Promise<SqlDriver | null> {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    return createNodeSqliteDriver(new DatabaseSync(':memory:'));
  } catch {
    return null;
  }
}
