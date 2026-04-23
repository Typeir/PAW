/**
 * Minimal ambient type declarations for the `sql.js` package.
 * Covers only the API surface used by pawDb.ts.
 *
 * @module sql.js
 */
declare module 'sql.js' {
  /** Scalar value that can appear in a SQLite column. */
  type SqlValue = null | number | string | Uint8Array;

  /** Parameters accepted by a Statement's bind / exec methods. */
  type BindParams = SqlValue[] | Record<string, SqlValue> | null;

  /** A single result set returned by `Database.exec()`. */
  interface QueryExecResult {
    /** Column names in SELECT order. */
    columns: string[];
    /** Rows of values, each array aligned with `columns`. */
    values: SqlValue[][];
  }

  /** A prepared sql.js statement (a thin wrapper around the WASM `Statement`). */
  interface Statement {
    /**
     * Bind query parameters.
     *
     * @param {BindParams} [params] - Values to bind
     * @returns {boolean} True on success
     */
    bind(params?: BindParams): boolean;

    /**
     * Step the statement by one row.
     *
     * @returns {boolean} True if a row was returned, false when exhausted
     */
    step(): boolean;

    /**
     * Return the current row as a plain object.
     *
     * @returns {{ [key: string]: SqlValue }} Row object keyed by column name
     */
    getAsObject(): { [key: string]: SqlValue };

    /**
     * Free the statement from WASM memory.
     *
     * @returns {boolean} True on success
     */
    free(): boolean;
  }

  /** A sql.js in-memory database instance. */
  interface Database {
    /**
     * Execute one or more SQL statements.
     *
     * @param {string} sql - SQL string to execute
     * @param {BindParams} [params] - Optional bind params (single-statement only)
     * @returns {QueryExecResult[]} Result sets
     */
    exec(sql: string, params?: BindParams): QueryExecResult[];

    /**
     * Execute a SQL statement without returning results.
     *
     * @param {string} sql - SQL string to execute
     * @param {BindParams} [params] - Optional bind params
     * @returns {Database} This database instance (for chaining)
     */
    run(sql: string, params?: BindParams): Database;

    /**
     * Prepare a SQL statement.
     *
     * @param {string} sql - SQL string to prepare
     * @returns {Statement} Prepared statement
     */
    prepare(sql: string): Statement;

    /**
     * Export the database contents as a Uint8Array (SQLite binary format).
     *
     * @returns {Uint8Array} SQLite file bytes
     */
    export(): Uint8Array;

    /**
     * Close the database and release WASM memory.
     */
    close(): void;
  }

  /** Constructor for a sql.js `Database`. */
  interface SqlJsStatic {
    /**
     * Create a new in-memory database, optionally from existing bytes.
     *
     * @param {ArrayLike<number> | Buffer | null} [data] - SQLite file bytes to load
     */
    new (data?: ArrayLike<number> | Buffer | null): Database;
    /** `Database` constructor — re-exported for named `type` imports. */
    readonly Database: new (
      data?: ArrayLike<number> | Buffer | null,
    ) => Database;
  }

  /**
   * Initialize the sql.js WASM module.
   *
   * @param {{ locateFile?: (filename: string) => string }} [config] - Optional loader config
   * @returns {Promise<SqlJsStatic>} Resolved sql.js static namespace
   */
  function initSqlJs(config?: {
    locateFile?: (filename: string) => string;
  }): Promise<SqlJsStatic>;

  export default initSqlJs;
  export type {
    BindParams, Database, QueryExecResult,
    SqlJsStatic, SqlValue, Statement
  };
}
