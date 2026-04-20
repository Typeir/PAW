/**
 * PAW Session-End Memory Save Hook
 *
 * @fileoverview Extracts decisions, patterns, and task metadata from a completed
 * session and persists them to paw.sqlite. Runs first in the sessionEnd array
 * so the health gate reads the freshest data.
 *
 * @module .github/PAW/hooks/session-end-memory-save
 * @author PAW
 * @version 1.0.0
 * @since 3.0.0
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
    isNestedHookRun,
    readHookInput,
    writeHookOutput,
} from '../hook-runtime';
import type { PawDatabase } from '../paw-db';
import { DEFAULT_DB_PATH, openDb } from '../paw-db';
import { PAW_DIR, PROJECT_ROOT as ROOT, getTasksDir } from '../paw-paths';
import { runPlugins } from '../plugin-loader';

/**
 * Parsed decision extracted from a task file.
 */
interface Decision {
  context: string;
  choice: string;
  rationale: string;
  domain: string;
}

/**
 * Ensure all required tables and indices exist (idempotent).
 * Delegates to paw-db.ensureSchema — kept here as no-op for signature compat.
 *
 * @param _db - SQLite database instance (schema already applied by openDb)
 */
function ensureSchema(_db: PawDatabase): void {
  /** Schema is initialized by paw-db.openDb() — nothing to do */
}

/**
 * Find the most recently modified task file in the configured tasks directory.
 *
 * @returns Absolute path to the active task file, or null
 */
function findActiveTaskFile(): string | null {
  const tasksDir = getTasksDir();
  if (!tasksDir || !existsSync(tasksDir)) return null;

  const files = readdirSync(tasksDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const full = path.join(tasksDir, f);
      return { path: full, mtime: statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  return files.length > 0 ? files[0].path : null;
}

/**
 * Extract a title from a task file (first H1 heading).
 *
 * @param content - Task file content
 * @returns Title string or fallback
 */
function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled task';
}

/**
 * Determine task status from content markers.
 *
 * @param content - Task file content
 * @returns Status string
 */
function extractStatus(content: string): string {
  if (/\[x\].*completed|status:\s*completed/i.test(content)) return 'completed';
  if (/status:\s*in.progress/i.test(content)) return 'in-progress';
  return 'unknown';
}

/**
 * Load optional domain list from .paw/config.json.
 * Returns empty array when no config or no domains key.
 *
 * @returns {string[]} Project-defined domain keywords
 */
function loadDomains(): string[] {
  const configPath = path.join(PAW_DIR, 'config.json');
  if (!existsSync(configPath)) return [];
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    if (Array.isArray(config.domains)) {
      return config.domains.filter((d: unknown) => typeof d === 'string');
    }
  } catch {
    /* config parse failure — return empty */
  }
  return [];
}

/**
 * Extract domain from task content using configured domain keywords.
 * Returns the first matching domain keyword found in the content,
 * or null if no domains are configured or none match.
 *
 * @param {string} content - Task file content
 * @returns {string | null} Domain string or null
 */
function extractDomain(content: string): string | null {
  const domains = loadDomains();
  if (domains.length === 0) return null;
  const lower = content.toLowerCase();
  return domains.find((d) => lower.includes(d.toLowerCase())) ?? null;
}

/**
 * Extract decisions from a task file's notes/decisions section.
 * Looks for markdown list items with "Decision:" or "Decided:" prefixes.
 *
 * @param content - Task file content
 * @returns Array of parsed decisions
 */
function extractDecisions(content: string): Decision[] {
  const decisions: Decision[] = [];
  const domain = extractDomain(content) ?? 'general';

  const decisionPattern =
    /^[-*]\s+(?:Decision|Decided):\s*(.+?)(?:\s*[—–-]\s*(.+?))?(?:\s*\((.+?)\))?$/gm;
  let match: RegExpExecArray | null;

  while ((match = decisionPattern.exec(content)) !== null) {
    const choice = match[1].trim();
    const rationale = match[2]?.trim() ?? '';
    const context = match[3]?.trim() ?? choice.slice(0, 60);

    if (choice.length > 0) {
      decisions.push({ context, choice, rationale, domain });
    }
  }

  return decisions;
}

/**
 * Extract pattern names from hook input or task content.
 * Looks for "Pattern:" markers in task files or patternNames in hook input.
 *
 * @param input - Hook input payload
 * @returns Array of pattern name strings
 */
function extractAppliedPatterns(input: Record<string, unknown>): string[] {
  const names = new Set<string>();

  if (Array.isArray(input.patternNames)) {
    for (const n of input.patternNames) {
      if (typeof n === 'string') names.add(n);
    }
  }

  const taskFile = findActiveTaskFile();
  if (taskFile) {
    const content = readFileSync(taskFile, 'utf-8');
    const patternRe = /^[-*]\s+Pattern:\s*(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = patternRe.exec(content)) !== null) {
      names.add(match[1].trim());
    }
  }

  return [...names];
}

/**
 * Index a task file in the task_index table (upsert).
 *
 * @param db - SQLite database instance
 * @param filePath - Absolute path to task file
 */
function indexTaskFile(db: PawDatabase, filePath: string): void {
  const content = readFileSync(filePath, 'utf-8');
  const title = extractTitle(content);
  const status = extractStatus(content);
  const domain = extractDomain(content);
  const relativePath = path.relative(ROOT, filePath).replace(/\\/g, '/');

  const summary = content
    .split('\n')
    .filter((l) => l.startsWith('- ') || l.startsWith('* '))
    .slice(0, 5)
    .join('; ')
    .slice(0, 300);

  db.prepare(
    `
    INSERT INTO task_index (file_path, title, status, domain, summary)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      title = excluded.title,
      status = excluded.status,
      domain = excluded.domain,
      summary = excluded.summary,
      completed_at = CASE WHEN excluded.status = 'completed' THEN datetime('now') ELSE completed_at END
  `,
  ).run(relativePath, title, status, domain, summary);
}

/**
 * Main hook entrypoint.
 */
async function main(): Promise<void> {
  const input = await readHookInput();
  if (isNestedHookRun(input)) {
    writeHookOutput({ continue: true });
    return;
  }

  const db = await openDb(DEFAULT_DB_PATH);
  try {
    ensureSchema(db);

    const taskFile = findActiveTaskFile();
    if (taskFile) {
      indexTaskFile(db, taskFile);

      const content = readFileSync(taskFile, 'utf-8');
      const decisions = extractDecisions(content);
      const taskRelPath = path.relative(ROOT, taskFile).replace(/\\/g, '/');

      for (const d of decisions) {
        db.prepare(
          `
          INSERT INTO decisions (context, choice, rationale, domain, source_task)
          VALUES (?, ?, ?, ?, ?)
        `,
        ).run(d.context, d.choice, d.rationale, d.domain, taskRelPath);
      }
    }

    const appliedPatterns = extractAppliedPatterns(input);
    for (const name of appliedPatterns) {
      const existing = db
        .prepare('SELECT id FROM patterns WHERE name = ?')
        .get(name);
      if (existing) {
        db.prepare(
          `
          UPDATE patterns SET occurrences = occurrences + 1, last_seen = datetime('now')
          WHERE name = ?
        `,
        ).run(name);
      }
    }

    await runPlugins('session-end', input, db);
  } finally {
    db.close();
  }

  writeHookOutput({ continue: true });
}

main().catch(() => {
  writeHookOutput({ continue: true });
});
