/**
 * PAW Kysely Dialect over the SqlDriver seam
 *
 * @fileoverview Lets Kysely — the typed query builder that is now the store's
 * default interface — run through PAW's own {@link SqlDriver} rather than one of
 * Kysely's engine-specific dialects. That is the whole point: the dual-engine
 * seam (native `node:sqlite` and WASM sql.js, one narrow sync surface) stays the
 * source of truth, and Kysely composes on top of it instead of replacing it. A
 * compiled query is routed by shape — a `select`/`pragma` reads rows, anything
 * else reports a change count — and transactions map to `begin`/`commit`/
 * `rollback`, so the migrator and explicit transactions work when the schema
 * grows (memory, second brain) even though today's queries need neither.
 *
 * The sync driver is wrapped in the async connection Kysely expects; there is one
 * connection because there is one in-process database, so acquire/release are
 * no-ops and the store owns the driver's real lifecycle via `close()`.
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
 * The store's schema as Kysely sees it — one row shape per table. `Generated`
 * marks the columns the database fills in, so an insert need not name them.
 *
 * @interface Database
 * @property {object} violations - The violation rows.
 * @property {object} paw_config - The project settings key/value rows.
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
 * The one connection: the sync {@link SqlDriver} presented as the async surface
 * Kysely drives. Reads go to `all`, writes to `run`; streaming is not offered
 * because an in-memory engine has nothing to stream.
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
 * Kysely's driver over the single connection. Transactions are plain SQL
 * statements against that connection.
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
 * The Kysely dialect that runs through a {@link SqlDriver}.
 *
 * @param {SqlDriver} db - The engine binding to execute against.
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
 * Build a typed Kysely instance over a driver — the store's handle to the DB.
 *
 * @param {SqlDriver} db - The engine binding.
 * @returns {Kysely<Database>} The query builder.
 */
export function createKysely(db: SqlDriver): Kysely<Database> {
  return new Kysely<Database>({ dialect: sqlDriverDialect(db) });
}
