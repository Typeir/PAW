/**
 * PAW sql.js Driver
 *
 * @fileoverview Bind WASM sql.js engine to {@link SqlDriver} seam. Use for machine
 * where native binding blocked. sql.js keep database in memory, no file
 * concept. Durability adapter job: hand serialised database to injected writer after every mutation.
 *
 * Write whole-file, expensive; `sqlite` default. Writer injected; failing write propagate (CONSTRAINTS.md Constraint 3: store that cannot write throw).
 *
 * @module @paw/adapters/store/sql/sqlJsDriver
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { SqlDriver, SqlRow, SqlValue } from './driver.js';

/**
 * Value sql.js can return. Wider than {@link SqlValue}: SQLite have BLOB type
 * PAW schema never declare. See {@link narrow}.
 */
export type SqlJsValue = SqlValue | Uint8Array;

/**
 * One result set as sql.js return it.
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
 * Narrow engine value to one PAW schema can hold.
 *
 * No table PAW create declare BLOB column; binary value mean file not PAW database.
 *
 * @param {SqlJsValue} value - The value engine return.
 * @param {string} column - The column it came from, for error message.
 * @returns {SqlValue} The narrowed value.
 * @throws {Error} When value be binary.
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
 * The sql.js database surface this driver use.
 *
 * @interface SqlJsDatabase
 * @property {(sql: string, params?: SqlValue[]) => void} run - Execute statements, discard results.
 * @property {(sql: string, params?: SqlValue[]) => SqlJsExecResult[]} exec - Execute query, return result sets.
 * @property {() => number} getRowsModified - Rows changed by last mutation.
 * @property {() => Uint8Array} export - Serialise whole database.
 * @property {() => void} close - Release database.
 */
export interface SqlJsDatabase {
  run(sql: string, params?: SqlValue[]): void;
  exec(sql: string, params?: SqlValue[]): SqlJsExecResult[];
  getRowsModified(): number;
  export(): Uint8Array;
  close(): void;
}

/**
 * Write serialised database somewhere durable.
 */
export type SqlJsPersist = (data: Uint8Array) => void;

/**
 * Bind open sql.js database to driver seam.
 *
 * @param {SqlJsDatabase} db - Open in-memory database.
 * @param {SqlJsPersist} persist - Receive serialised database after every mutation.
 * @returns {SqlDriver} The driver.
 */
export function createSqlJsDriver(
  db: SqlJsDatabase,
  persist: SqlJsPersist,
): SqlDriver {
  // Defer whole-file write while transaction open: `export()` serialise database,
  // doing that mid-transaction end transaction out from under caller. So `begin`
  // raise depth, `commit`/`rollback` lower it, persist happen only once outermost
  // transaction close — the committed (or rolled-back) state, write once.
  let txDepth = 0;
  const track = (sql: string): void => {
    if (/^\s*begin\b/i.test(sql)) {
      txDepth += 1;
    } else if (/^\s*(commit|rollback|end)\b/i.test(sql)) {
      txDepth = Math.max(0, txDepth - 1);
    }
  };
  const commit = (sql: string): void => {
    track(sql);
    if (txDepth === 0) {
      persist(db.export());
    }
  };

  return {
    exec(sql: string): void {
      db.run(sql);
      commit(sql);
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
      commit(sql);
      return changed;
    },

    close(): void {
      db.close();
    },
  };
}
