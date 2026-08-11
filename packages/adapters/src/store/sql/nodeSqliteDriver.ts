/**
 * PAW node:sqlite driver.
 *
 * @fileoverview Bind native `node:sqlite` engine to {@link SqlDriver} seam. Give file locking, incremental writes, no install dependency, single-artifact bundling. Preferred engine; some managed machines block native binding. Takes already-open database; engine loading split into {@link loadNodeSqliteCtor}.
 *
 * @module @paw/adapters/store/sql/nodeSqliteDriver
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { SqlDriver, SqlRow, SqlValue } from './driver.js';

/**
 * Prepared-statement surface this driver use.
 *
 * @interface NodeSqliteStatement
 * @property {(...params: SqlValue[]) => unknown[]} all - Execute query, return every row.
 * @property {(...params: SqlValue[]) => { changes: number | bigint }} run - Execute mutation, report rows changed.
 */
export interface NodeSqliteStatement {
  all(...params: SqlValue[]): unknown[];
  run(...params: SqlValue[]): { changes: number | bigint };
}

/**
 * Database surface this driver use, structurally match `DatabaseSync`.
 *
 * @interface NodeSqliteDatabase
 * @property {(sql: string) => void} exec - Execute statement, return nothing.
 * @property {(sql: string) => NodeSqliteStatement} prepare - Compile statement.
 * @property {() => void} close - Release database.
 */
export interface NodeSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
  close(): void;
}

/**
 * `DatabaseSync` constructor.
 */
export type NodeSqliteCtor = new (path: string) => NodeSqliteDatabase;

/**
 * Bind open `node:sqlite` database to driver seam.
 *
 * @param {NodeSqliteDatabase} db - Open database.
 * @returns {SqlDriver} Driver.
 */
export function createNodeSqliteDriver(db: NodeSqliteDatabase): SqlDriver {
  return {
    exec(sql: string): void {
      db.exec(sql);
    },

    all(sql: string, params: readonly SqlValue[] = []): readonly SqlRow[] {
      return db.prepare(sql).all(...params) as SqlRow[];
    },

    run(sql: string, params: readonly SqlValue[] = []): number {
      return Number(db.prepare(sql).run(...params).changes);
    },

    close(): void {
      db.close();
    },
  };
}

/* c8 ignore start -- engine absent on machine that block native SQLite binding,
   import cannot run there; every branch of driver it feeds covered by double in
   drivers.test.ts. */
/**
 * Load native engine constructor.
 *
 * Separated from {@link createNodeSqliteDriver} and imported dynamically; machine
 * without engine fail on database open, message name the engine.
 *
 * @returns {Promise<NodeSqliteCtor>} `DatabaseSync` constructor.
 * @throws {Error} When `node:sqlite` unavailable on this runtime.
 */
export async function loadNodeSqliteCtor(): Promise<NodeSqliteCtor> {
  try {
    const mod = (await import('node:sqlite')) as unknown as {
      DatabaseSync: NodeSqliteCtor;
    };
    return mod.DatabaseSync;
  } catch (err: unknown) {
    throw new Error(
      `PAW store engine "sqlite" is unavailable on this machine: ${err instanceof Error ? err.message : String(err)}. Run \`paw config db wasm\` to use the bundled WASM engine instead.`,
    );
  }
}
/* c8 ignore stop */
