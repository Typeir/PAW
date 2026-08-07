/**
 * PAW sql.js Driver
 *
 * @fileoverview Binds the WASM sql.js engine to the {@link SqlDriver} seam, for
 * machines where the native binding is blocked. sql.js holds the database in
 * memory and has no concept of a file, so durability is this adapter's job: it
 * hands the serialised database to an injected writer after every mutation.
 *
 * That write is whole-file and therefore the expensive part of this engine — it
 * is the reason `sqlite` is the default. The writer is injected rather than
 * imported so the failure path is testable, and a failing write propagates
 * (CONSTRAINTS.md Constraint 3: a store that cannot write throws, because a
 * violation that was silently not persisted is a gate that silently passed).
 *
 * @module @paw/adapters/store/sql/sqlJsDriver
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { SqlDriver, SqlRow, SqlValue } from './driver.js';

/**
 * A value sql.js can return. Wider than {@link SqlValue} because SQLite has a
 * BLOB type that PAW's schema never declares — see {@link narrow}.
 */
export type SqlJsValue = SqlValue | Uint8Array;

/**
 * One result set as sql.js returns it.
 *
 * @interface SqlJsExecResult
 * @property {string[]} columns - Column names, in order.
 * @property {SqlJsValue[][]} values - Row values, aligned to `columns`.
 */
export interface SqlJsExecResult {
  columns: string[];
  values: SqlJsValue[][];
}

/**
 * Narrow an engine value to one PAW's schema can hold.
 *
 * No table PAW creates declares a BLOB column, so a binary value means the file
 * is not the database PAW thinks it is. That is reported rather than coerced,
 * because silently stringifying someone else's data would hide the mix-up until
 * it surfaced as a nonsense violation message.
 *
 * @param {SqlJsValue} value - The value the engine returned.
 * @param {string} column - The column it came from, for the error message.
 * @returns {SqlValue} The narrowed value.
 * @throws {Error} When the value is binary.
 */
function narrow(value: SqlJsValue, column: string): SqlValue {
  if (value instanceof Uint8Array) {
    throw new Error(
      `PAW store: column "${column}" holds a BLOB, which no PAW table declares. This database was not created by PAW.`,
    );
  }
  return value;
}

/**
 * The sql.js database surface this driver uses.
 *
 * @interface SqlJsDatabase
 * @property {(sql: string, params?: SqlValue[]) => void} run - Execute statements, discarding results.
 * @property {(sql: string, params?: SqlValue[]) => SqlJsExecResult[]} exec - Execute a query and return result sets.
 * @property {() => number} getRowsModified - Rows changed by the last mutation.
 * @property {() => Uint8Array} export - Serialise the whole database.
 * @property {() => void} close - Release the database.
 */
export interface SqlJsDatabase {
  run(sql: string, params?: SqlValue[]): void;
  exec(sql: string, params?: SqlValue[]): SqlJsExecResult[];
  getRowsModified(): number;
  export(): Uint8Array;
  close(): void;
}

/**
 * Writes the serialised database somewhere durable.
 */
export type SqlJsPersist = (data: Uint8Array) => void;

/**
 * Bind an open sql.js database to the driver seam.
 *
 * @param {SqlJsDatabase} db - An open in-memory database.
 * @param {SqlJsPersist} persist - Receives the serialised database after every mutation.
 * @returns {SqlDriver} The driver.
 */
export function createSqlJsDriver(
  db: SqlJsDatabase,
  persist: SqlJsPersist,
): SqlDriver {
  const flush = (): void => {
    persist(db.export());
  };

  return {
    exec(sql: string): void {
      db.run(sql);
      flush();
    },

    all(sql: string, params: readonly SqlValue[] = []): readonly SqlRow[] {
      const results = db.exec(sql, [...params]);
      if (results.length === 0) {
        return [];
      }
      const { columns, values } = results[0];
      return values.map((row) => {
        const out: Record<string, SqlValue> = {};
        columns.forEach((column, index) => {
          out[column] = narrow(row[index], column);
        });
        return out;
      });
    },

    run(sql: string, params: readonly SqlValue[] = []): number {
      db.run(sql, [...params]);
      const changed = db.getRowsModified();
      flush();
      return changed;
    },

    close(): void {
      db.close();
    },
  };
}
