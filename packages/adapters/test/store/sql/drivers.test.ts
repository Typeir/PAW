/**
 * PAW SQL Driver Tests
 *
 * @fileoverview Cover both engine bindings. Drive `node:sqlite` binding
 * against hand-written double, cover every branch on machine where engine
 * blocked, and against real engine when present. Drive sql.js binding
 * against real engine throughout; assert write-back path propagate failing
 * write (CONSTRAINTS.md Constraint 3).
 *
 * @module @paw/adapters/test/store/sql/drivers
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import type { SqlValue } from '../../../src/store/sql/driver.js';
import {
  createNodeSqliteDriver,
  type NodeSqliteDatabase,
} from '../../../src/store/sql/nodeSqliteDriver.js';
import {
  createSqlJsDriver,
  type SqlJsDatabase,
} from '../../../src/store/sql/sqlJsDriver.js';
import { createSqlStore } from '../../../src/store/sql/sqlStore.js';
import {
  openNodeSqliteMemoryDriver,
  openSqlJsMemoryDriver,
} from './helpers.js';

/**
 * Record call made to {@link NodeSqliteDatabase} double.
 *
 * @interface DoubleLog
 * @property {string[]} execs - SQL passed to `exec`.
 * @property {Array<{ sql: string; params: readonly SqlValue[] }>} runs - Statements run.
 * @property {number} closed - How many time `close` called.
 */
interface DoubleLog {
  execs: string[];
  runs: { sql: string; params: readonly SqlValue[] }[];
  closed: number;
}

/**
 * Build `node:sqlite` database double. Statement return canned rows.
 *
 * @param {Record<string, unknown>[]} rows - Rows every `all` returns.
 * @param {number | bigint} changes - The `changes` every `run` reports.
 * @returns {{ db: NodeSqliteDatabase; log: DoubleLog }} The double and its log.
 */
function nodeSqliteDouble(
  rows: Record<string, unknown>[] = [],
  changes: number | bigint = 0,
): { db: NodeSqliteDatabase; log: DoubleLog } {
  const log: DoubleLog = { execs: [], runs: [], closed: 0 };
  const db: NodeSqliteDatabase = {
    exec(sql) {
      log.execs.push(sql);
    },
    prepare(sql) {
      return {
        all(...params) {
          log.runs.push({ sql, params: params as readonly SqlValue[] });
          return rows;
        },
        run(...params) {
          log.runs.push({ sql, params: params as readonly SqlValue[] });
          return { changes };
        },
      };
    },
    close() {
      log.closed += 1;
    },
  };
  return { db, log };
}

describe('createNodeSqliteDriver', () => {
  it('passes exec straight through', () => {
    const { db, log } = nodeSqliteDouble();
    createNodeSqliteDriver(db).exec('CREATE TABLE t(a)');
    expect(log.execs).toEqual(['CREATE TABLE t(a)']);
  });

  it('returns rows from all', () => {
    const { db } = nodeSqliteDouble([{ a: 1 }]);
    expect(createNodeSqliteDriver(db).all('SELECT a FROM t')).toEqual([{ a: 1 }]);
  });

  it('spreads params into the prepared statement', () => {
    const { db, log } = nodeSqliteDouble();
    createNodeSqliteDriver(db).all('SELECT ?', ['x']);
    expect(log.runs[0].params).toEqual(['x']);
  });

  it('runs with no params when none are given', () => {
    const { db, log } = nodeSqliteDouble();
    createNodeSqliteDriver(db).run('DELETE FROM t');
    expect(log.runs[0].params).toEqual([]);
  });

  it('reports the change count as a number', () => {
    const { db } = nodeSqliteDouble([], 3);
    expect(createNodeSqliteDriver(db).run('DELETE FROM t')).toBe(3);
  });

  it('narrows a bigint change count to a number', () => {
    const { db } = nodeSqliteDouble([], 7n);
    const changed = createNodeSqliteDriver(db).run('DELETE FROM t');
    expect(changed).toBe(7);
    expect(typeof changed).toBe('number');
  });

  it('closes the underlying database', () => {
    const { db, log } = nodeSqliteDouble();
    createNodeSqliteDriver(db).close();
    expect(log.closed).toBe(1);
  });
});

describe('createSqlJsDriver', () => {
  it('persists after a mutating run', async () => {
    const initSqlJs = (await import('sql.js')).default;
    const engine = await initSqlJs();
    const writes: number[] = [];
    const driver = createSqlJsDriver(new engine.Database(), (data) => {
      writes.push(data.byteLength);
    });

    driver.exec('CREATE TABLE t(a TEXT)');
    expect(writes.length).toBeGreaterThan(0);

    const before = writes.length;
    driver.run('INSERT INTO t(a) VALUES (?)', ['x']);
    expect(writes.length).toBeGreaterThan(before);
  });

  it('reports rows and change counts from the real engine', async () => {
    const driver = await openSqlJsMemoryDriver();
    driver.exec('CREATE TABLE t(a TEXT)');
    expect(driver.run('INSERT INTO t(a) VALUES (?)', ['x'])).toBe(1);
    expect(driver.all('SELECT a FROM t')).toEqual([{ a: 'x' }]);
  });

  it('returns an empty array when a query matches nothing', async () => {
    const driver = await openSqlJsMemoryDriver();
    driver.exec('CREATE TABLE t(a TEXT)');
    expect(driver.all('SELECT a FROM t WHERE a = ?', ['nope'])).toEqual([]);
  });

  it('propagates a failing write rather than swallowing it', async () => {
    const initSqlJs = (await import('sql.js')).default;
    const engine = await initSqlJs();
    const driver = createSqlJsDriver(new engine.Database(), () => {
      throw new Error('disk full');
    });
    expect(() => driver.exec('CREATE TABLE t(a TEXT)')).toThrow('disk full');
  });

  it('closes the underlying database', async () => {
    const driver = await openSqlJsMemoryDriver();
    expect(() => driver.close()).not.toThrow();
  });

  it('reports a BLOB column rather than coercing someone else’s database', () => {
    const db: SqlJsDatabase = {
      run: () => undefined,
      exec: () => [{ columns: ['a'], values: [[new Uint8Array([1, 2])]] }],
      getRowsModified: () => 0,
      export: () => new Uint8Array(),
      close: () => undefined,
    };
    expect(() => createSqlJsDriver(db, () => undefined).all('SELECT a')).toThrow(
      /column "a" holds a BLOB/,
    );
  });
});

describe('engine parity', () => {
  it('gives node:sqlite the same store behaviour as sql.js, when available', async () => {
    const driver = await openNodeSqliteMemoryDriver();
    if (driver === null) {
      expect(driver).toBeNull();
      return;
    }

    const store = createSqlStore(driver);
    await store.raise(
      [
        {
          id: 0,
          filePath: 'src/a.ts',
          rule: 'no-any',
          message: 'no any',
          indirectFix: true,
        },
      ],
      'sess-1',
    );

    const rows = await store.unresolvedFor('sess-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].indirectFix).toBe(true);
    expect(rows[0].id).toBeGreaterThan(0);
    expect(await store.resolveForFile('src/a.ts', 'sess-1')).toBe(1);
    expect(await store.unresolvedFor('sess-1')).toEqual([]);

    await store.setConfig('paw.enabled', 'false');
    expect(await store.getConfig('paw.enabled')).toBe('false');
    driver.close();
  });
});
