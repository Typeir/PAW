/**
 * PAW Disk-Backed sql.js Store
 *
 * @fileoverview Opens a durable store backed by sql.js: database read
 * from a file under `.paw`, written back to the same file. The driver runs
 * each mutation and then commits; every mutation writes the whole file back.
 * pawd is the single writer.
 *
 * @module @paw/adapters/store/sql/openSqlJsStore
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import initSqlJs from 'sql.js';
import type { ConfigPort, StorePort } from '@paw/core';
import { createSqlStore } from './sqlStore.js';
import { createSqlJsDriver, type SqlJsDatabase } from './sqlJsDriver.js';

/**
 * Open (or create) disk-backed violation store at path.
 *
 * @param {string} dbPath - Absolute path to database file, e.g. `<root>/.paw/paw.sqlite`.
 * @returns {Promise<StorePort & ConfigPort>} Store, schema applied, persist to that file.
 */
export async function openSqlJsStore(
  dbPath: string,
): Promise<StorePort & ConfigPort> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const engine = await initSqlJs();
  const db = existsSync(dbPath)
    ? new engine.Database(readFileSync(dbPath))
    : new engine.Database();
  const persist = (data: Uint8Array): void => {
    writeFileSync(dbPath, Buffer.from(data));
  };
  return createSqlStore(createSqlJsDriver(db as unknown as SqlJsDatabase, persist));
}
