/**
 * PAW Store Schema
 *
 * @fileoverview Tables hex store own, SQL both supported engines accept.
 * `Violation` carry five fields; table carry those five columns plus two store
 * need to scope and retire row. No `severity`, no `hook_event`, no
 * `memory_type_id` foreign key.
 *
 * @todo Not destination shape. Three piece future work:
 *
 * 1. **Migrations.** Apply idempotent DDL only; work while every column
 *    additive and no deployed database exist. Column type or meaning change
 *    need versioned migration path: `schema_version` row and ordered steps.
 * 2. **Modularisation into pseudo-ORM.** Table definitions, SQL that read
 *    them, row-to-domain mapping span this file and `sqlStore.ts`. Group
 *    them per aggregate; adding table become one module.
 * 3. **The nine columns return.** `severity`, `hook_event`, `memory_type_id` and
 *    the rest dropped; nothing in hex domain read them yet. They return
 *    with surfaces that need them, and `Violation` grow to match.
 *
 * @module @paw/adapters/store/sql/schema
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Idempotent DDL for store. Applied on every open; fresh database and
 * existing one converge to same shape.
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
