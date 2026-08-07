/**
 * PAW Store Durability Tests
 *
 * @fileoverview Proves the thing the in-memory suites cannot: that a violation
 * raised by one process is still there for the next one. Every PAW hook is a
 * separate short-lived process, so a store that only holds state within a
 * process would report zero unresolved violations on every invocation — an
 * enforcement gate that silently always passes. These tests open a real file,
 * close it, reopen it, and assert the rows survived, for both engines.
 *
 * The `node:sqlite` case skips when the engine is unavailable, which is a
 * supported machine state rather than a failure — see the WASM engine.
 *
 * @module @paw/adapters/test/store/sql/durability
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { SqlDriver } from '../../../src/store/sql/driver.js';
import { createNodeSqliteDriver } from '../../../src/store/sql/nodeSqliteDriver.js';
import { createSqlJsDriver } from '../../../src/store/sql/sqlJsDriver.js';
import { createSqlStore } from '../../../src/store/sql/sqlStore.js';

const dir = mkdtempSync(join(tmpdir(), 'paw-store-durability-'));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Open a file-backed sql.js driver, loading any existing database and writing
 * the whole file back after each mutation.
 *
 * @param {string} path - The database file.
 * @returns {Promise<SqlDriver>} The driver.
 */
async function openWasm(path: string): Promise<SqlDriver> {
  const initSqlJs = (await import('sql.js')).default;
  const engine = await initSqlJs();
  const db = existsSync(path)
    ? new engine.Database(readFileSync(path))
    : new engine.Database();
  return createSqlJsDriver(db, (data) => {
    writeFileSync(path, Buffer.from(data));
  });
}

/**
 * Open a file-backed `node:sqlite` driver, or null when the engine is blocked.
 *
 * @param {string} path - The database file.
 * @returns {Promise<SqlDriver | null>} The driver, or null when unavailable.
 */
async function openNative(path: string): Promise<SqlDriver | null> {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    return createNodeSqliteDriver(new DatabaseSync(path));
  } catch {
    return null;
  }
}

const ENGINES: readonly [string, (p: string) => Promise<SqlDriver | null>][] = [
  ['wasm', openWasm],
  ['sqlite', openNative],
];

describe.each(ENGINES)('%s engine durability', (name, open) => {
  it('keeps violations and config across a close and reopen', async () => {
    const path = join(dir, `${name}.sqlite`);

    const first = await open(path);
    if (first === null) {
      expect(name).toBe('sqlite');
      return;
    }

    const writer = createSqlStore(first);
    await writer.raise(
      [
        {
          id: 0,
          filePath: 'src/a.ts',
          rule: 'no-any',
          message: 'survives a restart',
          indirectFix: true,
        },
      ],
      'sess-1',
    );
    await writer.setConfig('paw.enabled', 'false');
    first.close();

    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path).byteLength).toBeGreaterThan(0);

    const second = await open(path);
    expect(second).not.toBeNull();
    const reader = createSqlStore(second as SqlDriver);

    const rows = await reader.unresolvedFor('sess-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe('survives a restart');
    expect(rows[0].indirectFix).toBe(true);
    expect(await reader.getConfig('paw.enabled')).toBe('false');

    expect(await reader.resolveForFile('src/a.ts', 'sess-1')).toBe(1);
    (second as SqlDriver).close();

    const third = await open(path);
    const after = createSqlStore(third as SqlDriver);
    expect(await after.unresolvedFor('sess-1')).toEqual([]);
    (third as SqlDriver).close();
  });
});
