/**
 * PAW SQL Store Test Helpers
 *
 * @fileoverview Open real database engine in memory. Store suite run against SQL engine execute. Probe `node:sqlite` at call time via dynamic import. Absence on managed machine skip test.
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
 * Open in-memory sql.js driver. Persistence discarded.
 *
 * @returns {Promise<SqlDriver>} Driver over fresh in-memory database.
 */
export async function openSqlJsMemoryDriver(): Promise<SqlDriver> {
  const initSqlJs = (await import('sql.js')).default;
  const engine = await initSqlJs();
  return createSqlJsDriver(new engine.Database(), () => undefined);
}

/**
 * Open in-memory `node:sqlite` driver, or null when engine unavailable on machine.
 *
 * @returns {Promise<SqlDriver | null>} Driver, or null when unavailable.
 */
export async function openNodeSqliteMemoryDriver(): Promise<SqlDriver | null> {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    return createNodeSqliteDriver(new DatabaseSync(':memory:'));
  } catch {
    return null;
  }
}
