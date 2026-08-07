/**
 * PAW SQL Driver Seam
 *
 * @fileoverview The narrow surface every SQL engine PAW supports must provide,
 * so the store's SQL is written once and the engine becomes a swap. It exists
 * because the two engines PAW ships differ in ways that matter operationally
 * rather than logically: `node:sqlite` is a native binding some managed machines
 * block outright, and sql.js is a WASM database that must be serialised back to
 * disk by hand. Both reduce to "execute this SQL, hand me rows or a change
 * count", and that reduction is this interface.
 *
 * Synchronous by design: both engines are synchronous underneath, and the async
 * boundary belongs at the port ({@link StorePort}), not repeated per statement.
 *
 * @module @paw/adapters/store/sql/driver
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * A value SQLite can bind or return. PAW stores no blobs, so the binary column
 * type is deliberately absent.
 */
export type SqlValue = string | number | null;

/**
 * One row, keyed by column name.
 */
export type SqlRow = Readonly<Record<string, SqlValue>>;

/**
 * The engine operations the SQL store needs.
 *
 * @interface SqlDriver
 * @property {(sql: string) => void} exec - Execute one or more statements that return nothing.
 * @property {(sql: string, params?: readonly SqlValue[]) => readonly SqlRow[]} all - Execute a query and return every row.
 * @property {(sql: string, params?: readonly SqlValue[]) => number} run - Execute a mutation and return the number of rows it changed.
 * @property {() => void} close - Release the underlying database.
 */
export interface SqlDriver {
  exec(sql: string): void;
  all(sql: string, params?: readonly SqlValue[]): readonly SqlRow[];
  run(sql: string, params?: readonly SqlValue[]): number;
  close(): void;
}
