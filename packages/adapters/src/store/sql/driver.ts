/**
 * PAW SQL Driver Seam
 *
 * @fileoverview Narrow surface every SQL engine PAW supports provide. Store write SQL once; engine become swap. Two engines: `node:sqlite`, native binding some managed machine block outright, and sql.js, WASM database serialise back to disk by hand. Both reduce to "execute this SQL, return rows or change count", which this interface be.
 *
 * Synchronous: both engine synchronous underneath; async boundary sit at port ({@link StorePort}).
 *
 * @module @paw/adapters/store/sql/driver
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Value SQLite can bind or return. PAW store no blobs; binary column type absent.
 */
export type SqlValue = string | number | null;

/**
 * One row, key by column name.
 */
export type SqlRow = Readonly<Record<string, SqlValue>>;

/**
 * Engine operations SQL store need.
 *
 * @interface SqlDriver
 * @property {(sql: string) => void} exec - Execute one or more statement that return nothing.
 * @property {(sql: string, params?: readonly SqlValue[]) => readonly SqlRow[]} all - Execute query and return every row.
 * @property {(sql: string, params?: readonly SqlValue[]) => number} run - Execute mutation and return row count it changed.
 * @property {() => void} close - Release underlying database.
 */
export interface SqlDriver {
  exec(sql: string): void;
  all(sql: string, params?: readonly SqlValue[]): readonly SqlRow[];
  run(sql: string, params?: readonly SqlValue[]): number;
  close(): void;
}
