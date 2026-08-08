/**
 * PAW Disk-Backed sql.js Store
 *
 * @fileoverview Opens the durable store the daemon owns: a sql.js database read
 * from and written back to a file under `.paw`, exactly where the legacy PAW kept
 * `paw.sqlite`. Violations must outlive a daemon restart — a store that forgets
 * on restart is a gate that silently reopens — so this is what pawd runs, not the
 * in-memory fake. Durability rides on the driver's run-then-commit: every
 * mutation writes the whole file back, which is safe here precisely because pawd
 * is the single writer, so there is no second process to race the export.
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
 * Open (or create) the disk-backed violation store at a path.
 *
 * @param {string} dbPath - Absolute path to the database file, e.g. `<root>/.paw/paw.sqlite`.
 * @returns {Promise<StorePort & ConfigPort>} The store, schema applied, persisting to that file.
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
