/**
 * PAW Kysely dialect backed by {@link SqlDriver}.
 *
 * @fileoverview Runs Kysely's typed query builder on the store default database
 * interface through PAW own {@link SqlDriver}. The driver is a sync surface backed
 * by native `node:sqlite` or WASM sql.js; Kysely composes on top. Compiled query
 * rout by shape: `select`/`pragma` read rows, anything else report change count.
 * Transaction map to `begin`/`commit`/`rollback`.
 *
 * The sync driver is wrapped in the async connection Kysely's
 * {@link DatabaseConnection} requires. One connection, one in-process database;
 * acquire/release be no-ops, store own driver lifecycle via `close()`.
 *
 * @module @paw/adapters/store/sql/kyselyDialect
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  CompiledQuery,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type Generated,
  type QueryResult,
} from 'kysely';
import type { SqlDriver, SqlValue } from './driver.js';

/**
 * Store schema exposed to Kysely — one row shape per table. `Generated`
 * mark column database fill in; insert no need name them.
 *
 * @interface Database
 * @property {object} violations - Violation rows.
 * @property {object} paw_config - Project settings key/value rows.
 */
export interface Database {
  violations: {
    id: Generated<number>;
    file_path: string;
    rule: string;
    message: string;
    indirect_fix: number;
    session_id: string | null;
    resolved_at: Generated<string | null>;
  };
  paw_config: {
    key: string;
    value: string;
    updated_at: Generated<string>;
  };
}

/**
 * The single connection: sync {@link SqlDriver} exposed through the async surface
 * Kysely's {@link DatabaseConnection} drive. Read go to `all`, write to `run`;
 * no streaming.
 */
class SqlDriverConnection implements DatabaseConnection {
  constructor(private readonly db: SqlDriver) {}

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const params = query.parameters as readonly SqlValue[];
    if (/^\s*(select|pragma)/i.test(query.sql)) {
      return { rows: this.db.all(query.sql, params) as R[] };
    }
    return { rows: [], numAffectedRows: BigInt(this.db.run(query.sql, params)) };
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('PAW SqlDriver does not support streaming queries');
  }
}

/**
 * Kysely driver over single connection. Transaction be plain SQL
 * statement against that connection.
 */
class SqlDriverKyselyDriver implements Driver {
  private readonly connection: SqlDriverConnection;

  constructor(db: SqlDriver) {
    this.connection = new SqlDriverConnection(db);
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return this.connection;
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('begin'));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('commit'));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('rollback'));
  }

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {}
}

/**
 * Kysely dialect run through {@link SqlDriver}.
 *
 * @param {SqlDriver} db - Engine binding to execute against.
 * @returns {Dialect} A SQLite dialect backed by the driver.
 */
export function sqlDriverDialect(db: SqlDriver): Dialect {
  return {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new SqlDriverKyselyDriver(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
    createIntrospector: (kdb) => new SqliteIntrospector(kdb),
  };
}

/**
 * Build typed Kysely instance over a driver — store handle to DB.
 *
 * @param {SqlDriver} db - Engine binding.
 * @returns {Kysely<Database>} The query builder.
 */
export function createKysely(db: SqlDriver): Kysely<Database> {
  return new Kysely<Database>({ dialect: sqlDriverDialect(db) });
}
