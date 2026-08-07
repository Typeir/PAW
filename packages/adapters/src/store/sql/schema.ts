/**
 * PAW Store Schema
 *
 * @fileoverview The tables the hex store owns, as SQL both supported engines
 * accept. This is deliberately not the legacy nine-table schema: PAW has one
 * operator and no deployed copies, so the schema is written for the domain that
 * exists today rather than migrated from the one that accreted. `Violation`
 * carries five fields, so the table carries five columns plus the two the store
 * needs to scope and retire a row — no `severity`, no `hook_event`, and no
 * mandatory `memory_type_id` foreign key into a table nothing reads.
 *
 * @todo Not the destination shape. Three known pieces of future work, recorded
 * here so the shortcuts are deliberate rather than forgotten:
 *
 * 1. **Migrations.** This applies idempotent DDL and nothing else, which works
 *    only while every column is additive and no deployed database exists. Once
 *    a column changes type or meaning, this needs a real versioned migration
 *    path — a `schema_version` row and ordered steps — not `IF NOT EXISTS`.
 * 2. **Modularisation into a pseudo-ORM.** Table definitions, the SQL that
 *    reads them, and the row-to-domain mapping are currently spread across this
 *    file and `sqlStore.ts`. They belong together per aggregate, so adding a
 *    table is one module rather than an edit in three places.
 * 3. **The nine columns return.** `severity`, `hook_event`, `memory_type_id`
 *    and the rest were dropped because nothing in the hex domain reads them
 *    yet, not because they are unwanted. They come back with the surfaces that
 *    need them, and `Violation` grows to match.
 *
 * @module @paw/adapters/store/sql/schema
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Idempotent DDL for the store. Applied on every open, so a fresh database and
 * an existing one converge to the same shape.
 */
export const STORE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS violations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  rule TEXT NOT NULL,
  message TEXT NOT NULL,
  indirect_fix INTEGER NOT NULL DEFAULT 0,
  session_id TEXT,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_violations_open
  ON violations(file_path, session_id) WHERE resolved_at IS NULL;
CREATE TABLE IF NOT EXISTS paw_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
