/**
 * PAW node:sqlite Driver
 *
 * @fileoverview Binds the native `node:sqlite` engine to the {@link SqlDriver}
 * seam. This is the engine PAW prefers: real file locking, incremental writes,
 * no dependency to install, and bundleable into a single artifact — the WASM
 * alternative is none of those. It is not the default everywhere only because
 * some managed machines block the native binding outright.
 *
 * The binding takes an already-opened database rather than opening one, so every
 * branch here is covered by a double on machines where the engine is absent.
 * Loading the engine is separated into {@link loadNodeSqliteCtor} for the same
 * reason.
 *
 * @module @paw/adapters/store/sql/nodeSqliteDriver
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { SqlDriver, SqlRow, SqlValue } from './driver.js';

/**
 * The prepared-statement surface this driver uses.
 *
 * @interface NodeSqliteStatement
 * @property {(...params: SqlValue[]) => unknown[]} all - Execute a query and return every row.
 * @property {(...params: SqlValue[]) => { changes: number | bigint }} run - Execute a mutation and report the rows changed.
 */
export interface NodeSqliteStatement {
  all(...params: SqlValue[]): unknown[];
  run(...params: SqlValue[]): { changes: number | bigint };
}

/**
 * The database surface this driver uses, structurally matching `DatabaseSync`.
 *
 * @interface NodeSqliteDatabase
 * @property {(sql: string) => void} exec - Execute statements that return nothing.
 * @property {(sql: string) => NodeSqliteStatement} prepare - Compile a statement.
 * @property {() => void} close - Release the database.
 */
export interface NodeSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
  close(): void;
}

/**
 * The `DatabaseSync` constructor.
 */
export type NodeSqliteCtor = new (path: string) => NodeSqliteDatabase;

/**
 * Bind an open `node:sqlite` database to the driver seam.
 *
 * @param {NodeSqliteDatabase} db - An open database.
 * @returns {SqlDriver} The driver.
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

/* c8 ignore start -- the engine is absent on machines that block the native
   SQLite binding, so this import cannot be executed there; every branch of the
   driver it feeds is covered by a double in drivers.test.ts. */
/**
 * Load the native engine's constructor.
 *
 * Kept apart from {@link createNodeSqliteDriver} and imported dynamically so a
 * machine without the engine fails when it opens a database, with a message
 * naming the engine, rather than at module load with an import error that would
 * take the whole CLI down.
 *
 * @returns {Promise<NodeSqliteCtor>} The `DatabaseSync` constructor.
 * @throws {Error} When `node:sqlite` is unavailable on this runtime.
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
