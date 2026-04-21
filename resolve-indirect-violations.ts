/**
 * PAW Indirect Violation Resolver
 *
 * @fileoverview Shared utility that re-checks unresolved indirect-fix violations
 * in paw.sqlite and resolves any whose fix condition is now satisfied.
 *
 * Indirect-fix violations (e.g. missing-test) flag a SOURCE file but require
 * action on a DIFFERENT file (e.g. creating a test). Because post-tool-use only
 * gates the edited file, stale violations persist after the fix file is created.
 * This module provides a single reusable function that any hook can call to prune
 * those stale entries.
 *
 * @module .github/PAW/resolve-indirect-violations
 * @author Typeir
 * @version 1.0.0
 * @since 3.0.0
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ViolationRow } from './paw-db';
import { DEFAULT_DB_PATH, openDb, openDbReadonly } from './paw-db';
import { PROJECT_ROOT as ROOT } from './paw-paths';

/**
 * Result of a stale-violation resolution pass.
 *
 * @interface ResolutionResult
 * @property {number} checked - Number of indirect-fix violations examined
 * @property {number} resolved - Number of violations resolved (fix confirmed)
 * @property {string[]} resolvedFiles - File paths whose violations were cleared
 */
export interface ResolutionResult {
  checked: number;
  resolved: number;
  resolvedFiles: string[];
}

/**
 * Rule-specific resolution checkers.
 * Each function receives a source file path (project-relative, forward slashes)
 * and returns true when the indirect fix is now present.
 */
const INDIRECT_RESOLVERS: Record<string, (filePath: string) => boolean> = {
  'missing-test': (filePath: string): boolean => {
    const ext = filePath.endsWith('.tsx') ? '.tsx' : '.ts';
    const baseName = filePath.replace(/\.(ts|tsx)$/, '');
    const candidates = [
      path.join(ROOT, 'tests', 'unit', `${baseName}.test${ext}`),
      path.join(ROOT, 'tests', 'integration', `${baseName}.test${ext}`),
      path.join(ROOT, 'tests', 'unit', `${path.basename(baseName)}.test${ext}`),
      path.join(
        ROOT,
        'tests',
        'integration',
        `${path.basename(baseName)}.test${ext}`,
      ),
    ];
    return candidates.some((c) => existsSync(c));
  },
};

/**
 * Re-check all unresolved indirect-fix violations and resolve any whose
 * fix condition is now satisfied (e.g. test file exists for missing-test).
 *
 * Safe to call from any hook — reads violations in a read-only pass, then
 * opens a write connection only if resolutions are needed. Fails silently
 * on DB errors (fail-open).
 *
 * @param {string | null} [sessionId] - Optional session scope (unused for now — resolves all indirect)
 * @returns {ResolutionResult} Summary of checked and resolved violations
 */
export async function resolveStaleIndirectViolations(
  sessionId?: string | null,
): ResolutionResult {
  const result: ResolutionResult = {
    checked: 0,
    resolved: 0,
    resolvedFiles: [],
  };

  let violations: ViolationRow[];
  try {
    const readDb = await openDbReadonly(DEFAULT_DB_PATH);
    if (!readDb) return result;
    try {
      violations = readDb
        .prepare(
          `SELECT * FROM violations WHERE resolved_at IS NULL AND indirect_fix = 1`,
        )
        .all() as ViolationRow[];
    } finally {
      readDb.close();
    }
  } catch {
    return result;
  }

  if (violations.length === 0) return result;

  const toResolve: ViolationRow[] = [];
  for (const v of violations) {
    result.checked++;
    const checker = INDIRECT_RESOLVERS[v.rule];
    if (checker && checker(v.file_path)) {
      toResolve.push(v);
    }
  }

  if (toResolve.length === 0) return result;

  try {
    const writeDb = await openDb(DEFAULT_DB_PATH);
    if (!writeDb) return result;
    try {
      const stmt = writeDb.prepare(
        `UPDATE violations SET resolved_at = datetime('now') WHERE id = ? AND resolved_at IS NULL`,
      );
      for (const v of toResolve) {
        const changes = stmt.run(v.id).changes;
        if (changes > 0) {
          result.resolved++;
          if (!result.resolvedFiles.includes(v.file_path)) {
            result.resolvedFiles.push(v.file_path);
          }
        }
      }
    } finally {
      writeDb.close();
    }
  } catch {
    /* DB write failure — fail open */
  }

  return result;
}
