/**
 * PAW Database
 *
 * @fileoverview Central SQLite access layer for PAW using sql.js (pure JS, no native deps).
 * Provides schema initialization, connection management, and typed query helpers.
 * All PAW modules import from this file instead of directly requiring sql.js.
 *
 * sql.js operates in-memory; this module loads the DB file on open and persists
 * after every mutation via a lightweight wrapper.
 *
 * @module .github/PAW/paw-db
 * @author Typeir
 * @version 3.0.0
 * @since 3.0.0
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { DB_PATH } from './pawPaths';

/* ------------------------------------------------------------------ */
/*  sql.js engine — lazily initialized (avoids top-level await which  */
/*  breaks CJS transforms in tsx/esbuild)                             */
/* ------------------------------------------------------------------ */
let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

/**
 * Get the sql.js engine, initializing on first call.
 */
async function getSqlEngine(): Promise<Awaited<ReturnType<typeof initSqlJs>>> {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

/* ------------------------------------------------------------------ */
/*  PawDatabase wrapper — backward-compatible with better-sqlite3 API */
/* ------------------------------------------------------------------ */

/**
 * Persist a sql.js database to disk.
 */
function persistToFile(db: SqlJsDatabase, dbPath: string): void {
  const data = db.export();
  const buffer = Buffer.from(data);
  mkdirSync(dirname(dbPath), { recursive: true });
  writeFileSync(dbPath, buffer);
}

/**
 * Statement-like object returned by PawDatabase.prepare(), matching
 * the better-sqlite3 Statement surface used by PAW callers.
 */
export interface PawStatement {
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
  run(...params: unknown[]): {
    changes: number;
    lastInsertRowid: number | bigint;
  };
}

/**
 * Wrapped database that auto-persists to disk after mutations.
 * Exposes .prepare(), .pragma(), .exec(), and .close() for backward
 * compatibility with code originally written for better-sqlite3.
 */
export interface PawDatabase {
  /** Underlying sql.js database (escape hatch). */
  readonly _db: SqlJsDatabase;
  /** File path this database persists to. */
  readonly _path: string;
  /** Whether this is a read-only connection. */
  readonly _readonly: boolean;

  /**
   * Create a statement-like object (better-sqlite3 compat).
   * The returned object supports .get(), .all(), and .run() with params.
   */
  prepare(sql: string): PawStatement;

  /** No-op for sql.js — WAL / foreign_keys pragmas are silently ignored. */
  pragma(str: string): unknown;

  /** Execute raw SQL (DDL, multi-statement). Auto-persists if not readonly. */
  exec(sql: string): void;

  /** Close the database and release memory. */
  close(): void;
}

/**
 * Create a PawDatabase wrapper around a sql.js database.
 */
function wrapDatabase(
  db: SqlJsDatabase,
  dbPath: string,
  readonly: boolean,
): PawDatabase {
  return {
    _db: db,
    _path: dbPath,
    _readonly: readonly,

    prepare(sql: string): PawStatement {
      return {
        get(...params: unknown[]): Record<string, unknown> | undefined {
          const stmt = db.prepare(sql);
          if (params.length > 0) stmt.bind(params as never[]);
          if (stmt.step()) {
            const obj = stmt.getAsObject() as Record<string, unknown>;
            stmt.free();
            return obj;
          }
          stmt.free();
          return undefined;
        },

        all(...params: unknown[]): Record<string, unknown>[] {
          const results = db.exec(
            sql,
            params.length > 0 ? (params as never[]) : undefined,
          );
          if (results.length === 0) return [];
          const { columns, values } = results[0];
          return values.map((row) => {
            const obj: Record<string, unknown> = {};
            columns.forEach((col, i) => {
              obj[col] = row[i];
            });
            return obj;
          });
        },

        run(...params: unknown[]): {
          changes: number;
          lastInsertRowid: number | bigint;
        } {
          if (readonly) throw new Error('Cannot write to readonly database');
          db.run(sql, params.length > 0 ? (params as never[]) : undefined);
          const meta = db.exec(
            'SELECT changes() as c, last_insert_rowid() as r',
          );
          const changes =
            meta.length > 0 ? (meta[0].values[0][0] as number) : 0;
          const lastInsertRowid =
            meta.length > 0 ? (meta[0].values[0][1] as number) : 0;
          persistToFile(db, dbPath);
          return { changes, lastInsertRowid };
        },
      };
    },

    pragma(_str: string): unknown {
      /* sql.js runs in-memory — WAL, foreign_keys, etc. are no-ops */
      return undefined;
    },

    exec(sql: string): void {
      db.run(sql);
      if (!readonly) {
        persistToFile(db, dbPath);
      }
    },

    close(): void {
      db.close();
    },
  };
}

/**
 * Normalize a file path to forward slashes for consistent storage and lookup.
 * Preserves original casing to avoid false mismatches on case-sensitive
 * filesystems and incorrect paths in violation messages.
 *
 * @param p - Raw file path
 * @returns Normalized path string
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Default path to the PAW database file, inside the .paw/ directory.
 */
export const DEFAULT_DB_PATH = DB_PATH;

/**
 * Ensure all required tables and indices exist (idempotent).
 *
 * @param db - PawDatabase wrapper
 */
export function ensureSchema(db: PawDatabase): void {
  db._db.run(`
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      context TEXT NOT NULL,
      choice TEXT NOT NULL,
      rationale TEXT NOT NULL,
      domain TEXT,
      valid_from TEXT NOT NULL DEFAULT (datetime('now')),
      superseded_at TEXT,
      superseded_by INTEGER REFERENCES decisions(id),
      source_task TEXT,
      created_by TEXT DEFAULT 'agent'
    );
    CREATE TABLE IF NOT EXISTS patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      example TEXT,
      domain TEXT,
      occurrences INTEGER NOT NULL DEFAULT 1,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS agent_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL,
      hint TEXT NOT NULL,
      domain TEXT,
      confidence REAL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS task_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      domain TEXT,
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS memory_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      rule TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'error',
      hook_event TEXT NOT NULL,
      session_id TEXT,
      resolved_at TEXT,
      indirect_fix INTEGER NOT NULL DEFAULT 0,
      memory_type_id INTEGER NOT NULL REFERENCES memory_types(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS paw_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS file_memories (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path      TEXT NOT NULL,
      memory         TEXT NOT NULL,
      content_hash   TEXT,
      session_id     TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT DEFAULT (datetime('now')),
      UNIQUE (file_path, content_hash)
    );
    CREATE TABLE IF NOT EXISTS repo_conventions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT UNIQUE NOT NULL,
      description    TEXT,
      frequency      INTEGER DEFAULT 1,
      updated_at     TEXT DEFAULT (datetime('now'))
    );
  `);

  db._db.run(`
    CREATE INDEX IF NOT EXISTS idx_decisions_active ON decisions(superseded_at) WHERE superseded_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_decisions_domain ON decisions(domain);
    CREATE INDEX IF NOT EXISTS idx_patterns_domain ON patterns(domain);
    CREATE INDEX IF NOT EXISTS idx_patterns_occurrences ON patterns(occurrences DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory(agent);
    CREATE INDEX IF NOT EXISTS idx_task_index_status ON task_index(status);
    CREATE INDEX IF NOT EXISTS idx_task_index_domain ON task_index(domain);
    CREATE INDEX IF NOT EXISTS idx_violations_file ON violations(file_path);
    CREATE INDEX IF NOT EXISTS idx_violations_unresolved ON violations(resolved_at) WHERE resolved_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_violations_hook ON violations(hook_event);
    CREATE INDEX IF NOT EXISTS idx_violations_memory_type ON violations(memory_type_id);
    CREATE INDEX IF NOT EXISTS idx_violations_session ON violations(session_id) WHERE resolved_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_file_memories_path ON file_memories(file_path);
    CREATE INDEX IF NOT EXISTS idx_file_memories_hash ON file_memories(file_path, content_hash);
  `);

  persistToFile(db._db, db._path);
  seedMemoryTypes(db);
}

/**
 * Default memory type categories seeded on schema init.
 */
const DEFAULT_MEMORY_TYPES = [
  {
    name: 'decision',
    description: 'Architectural choice with supersession chain',
  },
  {
    name: 'pattern',
    description: 'Recurring codebase pattern with occurrence tracking',
  },
  {
    name: 'hint',
    description: 'Per-agent persistent hint from prior sessions',
  },
  { name: 'task', description: 'Task file index entry for rapid lookup' },
  {
    name: 'violation',
    description: 'Hook-detected rule violation with resolution tracking',
  },
] as const;

/**
 * Seed the memory_types table with default categories (idempotent).
 *
 * @param db - PawDatabase wrapper
 */
function seedMemoryTypes(db: PawDatabase): void {
  for (const mt of DEFAULT_MEMORY_TYPES) {
    db.prepare(
      'INSERT OR IGNORE INTO memory_types (name, description) VALUES (?, ?)',
    ).run(mt.name, mt.description);
  }
}

/**
 * Row shape returned from the violations table.
 */
export interface ViolationRow {
  id: number;
  file_path: string;
  rule: string;
  message: string;
  severity: string;
  hook_event: string;
  session_id: string | null;
  resolved_at: string | null;
  indirect_fix: number;
  memory_type_id: number;
  created_at: string;
}

/**
 * Look up the memory_type_id for a given type name.
 * Returns the cached 'violation' type id for the common case.
 *
 * @param db - SQLite database instance
 * @param typeName - Memory type name (e.g. 'violation')
 * @returns The integer id
 */
export function getMemoryTypeId(db: PawDatabase, typeName: string): number {
  const row = db
    .prepare('SELECT id FROM memory_types WHERE name = ?')
    .get(typeName) as { id: number } | undefined;
  if (!row) {
    throw new Error(`Unknown memory type: ${typeName}`);
  }
  return row.id;
}

/**
 * Insert a violation record into the violations table.
 *
 * @param db - SQLite database instance
 * @param violation - Violation data to persist
 * @returns The inserted row id
 */
export function insertViolation(
  db: PawDatabase,
  violation: {
    filePath: string;
    rule: string;
    message: string;
    severity?: string;
    hookEvent: string;
    sessionId?: string;
    indirectFix?: boolean;
  },
): number {
  const memoryTypeId = getMemoryTypeId(db, 'violation');
  const normalizedFilePath = normalizePath(violation.filePath);
  const result = db
    .prepare(
      `INSERT INTO violations (file_path, rule, message, severity, hook_event, session_id, indirect_fix, memory_type_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      normalizedFilePath,
      violation.rule,
      violation.message,
      violation.severity ?? 'error',
      violation.hookEvent,
      violation.sessionId ?? null,
      violation.indirectFix ? 1 : 0,
      memoryTypeId,
    );
  return Number(result.lastInsertRowid);
}

/**
 * Mark all unresolved violations for a file as resolved.
 *
 * @param db - SQLite database instance
 * @param filePath - Absolute file path to resolve violations for
 * @returns Number of rows updated
 */
export function resolveViolations(db: PawDatabase, filePath: string): number {
  const normalizedFilePath = normalizePath(filePath);
  const result = db
    .prepare(
      `UPDATE violations SET resolved_at = datetime('now')
       WHERE file_path = ? AND resolved_at IS NULL`,
    )
    .run(normalizedFilePath);
  return result.changes;
}

/**
 * Mark all unresolved violations as resolved (bulk clear).
 *
 * @param db - SQLite database instance
 * @returns Number of rows updated
 */
export function resolveAllViolations(db: PawDatabase): number {
  const result = db
    .prepare(
      `UPDATE violations SET resolved_at = datetime('now')
       WHERE resolved_at IS NULL`,
    )
    .run();
  return result.changes;
}

/**
 * Query all unresolved violations, optionally filtered by file path.
 *
 * @param db - SQLite database instance
 * @param filePath - Optional file path filter
 * @returns Array of unresolved violation rows
 */
export function getUnresolvedViolations(
  db: PawDatabase,
  filePath?: string,
): ViolationRow[] {
  if (filePath) {
    return db
      .prepare(
        `SELECT * FROM violations WHERE resolved_at IS NULL AND file_path = ? ORDER BY created_at DESC`,
      )
      .all(normalizePath(filePath)) as ViolationRow[];
  }
  return db
    .prepare(
      `SELECT * FROM violations WHERE resolved_at IS NULL ORDER BY created_at DESC`,
    )
    .all() as ViolationRow[];
}

/**
 * Query unresolved violations for a specific session plus project-scoped (NULL session).
 * This is the primary query for pre-tool-use blocking — it only returns violations
 * that should block THIS session.
 *
 * @param db - SQLite database instance
 * @param sessionId - Current session ID
 * @returns Array of unresolved violation rows for this session + project-scoped
 */
export function getSessionViolations(
  db: PawDatabase,
  sessionId: string,
): ViolationRow[] {
  return db
    .prepare(
      `SELECT * FROM violations
       WHERE resolved_at IS NULL AND (session_id = ? OR session_id IS NULL)
       ORDER BY created_at DESC`,
    )
    .all(sessionId) as ViolationRow[];
}

/**
 * Mark all unresolved violations for a specific session as resolved.
 *
 * @param db - SQLite database instance
 * @param sessionId - Session ID whose violations should be resolved
 * @returns Number of rows updated
 */
export function resolveSessionViolations(
  db: PawDatabase,
  sessionId: string,
): number {
  const result = db
    .prepare(
      `UPDATE violations SET resolved_at = datetime('now')
       WHERE session_id = ? AND resolved_at IS NULL`,
    )
    .run(sessionId);
  return result.changes;
}

/**
 * Escalate unresolved session violations to project scope by clearing session_id.
 * Called at session end — makes violations visible to ALL future sessions.
 *
 * @param db - SQLite database instance
 * @param sessionId - Session ID whose violations should be escalated
 * @returns Number of rows escalated
 */
export function escalateSessionViolations(
  db: PawDatabase,
  sessionId: string,
): number {
  const result = db
    .prepare(
      `UPDATE violations SET session_id = NULL
       WHERE session_id = ? AND resolved_at IS NULL`,
    )
    .run(sessionId);
  return result.changes;
}

/**
 * Resolve violations for a specific file within a specific session.
 * More precise than resolveViolations() which clears across all sessions.
 *
 * @param db - SQLite database instance
 * @param filePath - File path to resolve
 * @param sessionId - Session ID scope (null resolves project-scoped only)
 * @returns Number of rows updated
 */
export function resolveViolationsForFile(
  db: PawDatabase,
  filePath: string,
  sessionId: string | null,
): number {
  const normalizedFilePath = normalizePath(filePath);
  if (sessionId) {
    const result = db
      .prepare(
        `UPDATE violations SET resolved_at = datetime('now')
         WHERE file_path = ? AND session_id = ? AND resolved_at IS NULL`,
      )
      .run(normalizedFilePath, sessionId);
    return result.changes;
  }
  const result = db
    .prepare(
      `UPDATE violations SET resolved_at = datetime('now')
       WHERE file_path = ? AND session_id IS NULL AND resolved_at IS NULL`,
    )
    .run(normalizedFilePath);
  return result.changes;
}

/**
 * Delete resolved violations older than a retention period, and auto-resolve
 * unresolved violations that exceed a staleness TTL to prevent permanent blocks
 * from orphaned sessions.
 *
 * @param db - SQLite database instance
 * @param retentionDays - Number of days to retain resolved violations
 * @param staleTtlHours - Hours after which unresolved violations are auto-resolved
 * @returns Number of rows affected (deleted + auto-resolved)
 */
export function gcOldViolations(
  db: PawDatabase,
  retentionDays: number = 30,
  staleTtlHours: number = 48,
): number {
  const deleted = db
    .prepare(
      `DELETE FROM violations
       WHERE resolved_at IS NOT NULL
       AND resolved_at < datetime('now', '-' || ? || ' days')`,
    )
    .run(retentionDays).changes;

  const autoResolved = db
    .prepare(
      `UPDATE violations
       SET resolved_at = datetime('now')
       WHERE resolved_at IS NULL
       AND created_at < datetime('now', '-' || ? || ' hours')`,
    )
    .run(staleTtlHours).changes;

  return deleted + autoResolved;
}

/**
 * Get recent violation history (resolved and unresolved) for L1 context injection.
 *
 * @param db - SQLite database instance
 * @param limit - Maximum number of records to return
 * @returns Array of violation rows ordered by creation time
 */
export function getRecentViolations(
  db: PawDatabase,
  limit: number = 10,
): ViolationRow[] {
  return db
    .prepare(`SELECT * FROM violations ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as ViolationRow[];
}

/**
 * Resolve violations whose file no longer exists on disk.
 * This prevents orphaned violations from permanently blocking agents
 * after a file is deleted. Handles both absolute and project-relative
 * paths stored in the DB.
 *
 * @param db - SQLite database instance (must be writable)
 * @returns Number of violations resolved
 */
export function pruneOrphanedViolations(db: PawDatabase): number {
  const unresolved = db
    .prepare(
      `SELECT DISTINCT file_path FROM violations WHERE resolved_at IS NULL`,
    )
    .all() as Array<{ file_path: string }>;

  let pruned = 0;

  for (const row of unresolved) {
    const fp = row.file_path;
    const isAbsolute = /^[a-z]:\//i.test(fp) || fp.startsWith('/');
    const absPath = isAbsolute ? fp : join(process.cwd(), fp);
    if (!existsSync(absPath)) {
      pruned += db
        .prepare(
          `UPDATE violations SET resolved_at = datetime('now')
         WHERE file_path = ? AND resolved_at IS NULL`,
        )
        .run(fp).changes;
    }
  }
  return pruned;
}

/**
 * Read a value from the paw_config key-value store.
 *
 * @param db - SQLite database instance
 * @param key - Config key to read
 * @returns Stored value string, or null if the key does not exist
 */
export function getPawConfig(db: PawDatabase, key: string): string | null {
  const row = db
    .prepare('SELECT value FROM paw_config WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Write a value to the paw_config key-value store (upsert).
 *
 * @param db - SQLite database instance
 * @param key - Config key to set
 * @param value - Value to store
 */
export function setPawConfig(
  db: PawDatabase,
  key: string,
  value: string,
): void {
  db.prepare(
    `INSERT INTO paw_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(key, value);
}

/**
 * Row shape returned from the file_memories table.
 */
export interface FileMemoryRow {
  id: number;
  file_path: string;
  memory: string;
  content_hash: string | null;
  session_id: string | null;
  created_at: string;
  updated_at: string | null;
}

/**
 * Upsert a file memory. If a row with the same file_path + content_hash
 * already exists, update the memory text and timestamp.
 *
 * @param db - SQLite database instance
 * @param filePath - Normalized file path
 * @param memory - Generated memory text
 * @param contentHash - Hash of the file content at draft time
 * @param sessionId - Session that generated this memory
 */
export function upsertFileMemory(
  db: PawDatabase,
  filePath: string,
  memory: string,
  contentHash: string | null,
  sessionId: string | null,
): void {
  db.prepare(
    `INSERT INTO file_memories (file_path, memory, content_hash, session_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(file_path, content_hash)
     DO UPDATE SET memory = excluded.memory, updated_at = datetime('now')`,
  ).run(normalizePath(filePath), memory, contentHash, sessionId);
}

/**
 * Get the most recent file memory for a path, optionally matching a content hash.
 *
 * @param db - SQLite database instance
 * @param filePath - Normalized file path to query
 * @param contentHash - Optional hash to match current content
 * @returns The memory row or undefined
 */
export function getFileMemory(
  db: PawDatabase,
  filePath: string,
  contentHash?: string,
): FileMemoryRow | undefined {
  if (contentHash) {
    return db
      .prepare(
        `SELECT * FROM file_memories WHERE file_path = ? AND content_hash = ? LIMIT 1`,
      )
      .get(normalizePath(filePath), contentHash) as FileMemoryRow | undefined;
  }
  return db
    .prepare(
      `SELECT * FROM file_memories WHERE file_path = ? ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(normalizePath(filePath)) as FileMemoryRow | undefined;
}

/**
 * Get file memories for multiple paths (batch L1 query).
 *
 * @param db - SQLite database instance
 * @param filePaths - Array of normalized file paths
 * @returns Array of memory rows
 */
export function getFileMemories(
  db: PawDatabase,
  filePaths: string[],
): FileMemoryRow[] {
  if (filePaths.length === 0) return [];
  const placeholders = filePaths.map(() => '?').join(', ');
  const normalized = filePaths.map(normalizePath);
  return db
    .prepare(
      `SELECT * FROM file_memories WHERE file_path IN (${placeholders}) ORDER BY updated_at DESC`,
    )
    .all(...normalized) as FileMemoryRow[];
}

/**
 * Delete stale file memories older than the retention period.
 *
 * @param db - SQLite database instance
 * @param retentionDays - Days to retain memories
 * @returns Number of rows deleted
 */
export function gcStaleFileMemories(
  db: PawDatabase,
  retentionDays: number = 30,
): number {
  return db
    .prepare(
      `DELETE FROM file_memories WHERE updated_at < datetime('now', '-' || ? || ' days')`,
    )
    .run(retentionDays).changes;
}

export async function openDb(
  dbPath: string = DEFAULT_DB_PATH,
  options: { readonly?: boolean } = {},
): Promise<PawDatabase> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const engine = await getSqlEngine();

  let db: SqlJsDatabase;
  if (existsSync(dbPath)) {
    const fileBuffer = readFileSync(dbPath);
    db = new engine.Database(fileBuffer);
  } else {
    db = new engine.Database();
  }

  const wrapped = wrapDatabase(db, dbPath, options.readonly ?? false);

  if (!options.readonly) {
    ensureSchema(wrapped);
  }

  return wrapped;
}

/**
 * Open a read-only PAW database connection. Returns null if the database
 * file does not exist yet (first run before any writes).
 *
 * @param dbPath - Path to the SQLite file
 * @returns Database instance or null if file missing
 */
export async function openDbReadonly(
  dbPath: string = DEFAULT_DB_PATH,
): Promise<PawDatabase | null> {
  if (!existsSync(dbPath)) return null;
  return openDb(dbPath, { readonly: true });
}

/**
 * Supersede an existing decision with a new one. The old decision gets a
 * superseded_at timestamp and a reference to its replacement.
 *
 * @param db - Database connection
 * @param oldId - ID of the decision to supersede
 * @param newDecision - The replacement decision
 * @returns ID of the new decision
 */
export function supersedeDecision(
  db: PawDatabase,
  oldId: number,
  newDecision: {
    context: string;
    choice: string;
    rationale: string;
    domain?: string;
    sourceTask?: string;
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO decisions (context, choice, rationale, domain, source_task)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      newDecision.context,
      newDecision.choice,
      newDecision.rationale,
      newDecision.domain ?? null,
      newDecision.sourceTask ?? null,
    );

  const newId = Number(result.lastInsertRowid);

  db.prepare(
    `UPDATE decisions SET superseded_at = datetime('now'), superseded_by = ? WHERE id = ?`,
  ).run(newId, oldId);

  return newId;
}
