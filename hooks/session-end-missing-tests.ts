/**
 * PAW Session End Missing Tests Hook
 *
 * @fileoverview Blocks session completion when newly added source files don't
 * have corresponding test files. Also resolves stale indirect-fix violations
 * in paw.sqlite whose fix condition is now satisfied.
 *
 * @module .github/PAW/hooks/session-end-missing-tests
 * @author PAW
 * @version 2.0.0
 * @since 3.0.0
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
    isNestedHookRun,
    readHookInput,
    writeBlockingOutput,
    writeHookOutput,
} from '../../.github/PAW/hook-runtime';
import { PROJECT_ROOT as ROOT } from '../../.github/PAW/paw-paths';
import { resolveStaleIndirectViolations } from '../../.github/PAW/resolve-indirect-violations';

/**
 * File patterns excluded from the test-gap check.
 */
const EXCLUDED_PATTERNS = [
  /\.d\.ts$/,
  /\.config\.(ts|js)$/,
  /\/index\.(ts|tsx)$/,
  /\.module\.(scss|css)$/,
  /\.stories\.(ts|tsx)$/,
  /\.test\.(ts|tsx)$/,
  /\.constants\.(ts|tsx)$/,
];

/**
 * Execute a git command in repo root.
 *
 * @param command - Git command string
 * @returns stdout or empty string
 */
function git(command: string): string {
  try {
    return execSync(command, {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * List newly added source files that should have tests.
 *
 * @returns Relative source file paths
 */
function getNewSourceFiles(): string[] {
  const stagedAdded = git('git diff --cached --name-status -- src/');
  const untracked = git('git ls-files --others --exclude-standard -- src/');

  const stagedFiles = stagedAdded
    .split('\n')
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[0] === 'A' && Boolean(parts[1]))
    .map((parts) => parts[1]);

  const untrackedFiles = untracked.split('\n').filter(Boolean);

  const combined = new Set([...stagedFiles, ...untrackedFiles]);
  return [...combined]
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !EXCLUDED_PATTERNS.some((p) => p.test(f)));
}

/**
 * Check whether a source file has a corresponding test.
 *
 * @param sourcePath - Relative source file path
 * @returns True if test file exists
 */
function hasTestFile(sourcePath: string): boolean {
  const ext = sourcePath.endsWith('.tsx') ? '.tsx' : '.ts';
  const baseName = sourcePath.replace(/\.(ts|tsx)$/, '');

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
}

/**
 * Build a blocking context message for missing tests.
 *
 * @param missing - Source files without test files
 * @returns Multi-line block reason
 */
function buildBlockReason(missing: string[]): string {
  const details = missing
    .map((src) => {
      const ext = src.endsWith('.tsx') ? '.tsx' : '.ts';
      const base = src.replace(/\.(ts|tsx)$/, '');
      return `📄 ${src}\n   → tests/unit/${base}.test${ext}`;
    })
    .join('\n\n');

  return [
    `🚫 Missing tests for ${missing.length} newly added source file(s):`,
    '',
    details,
    '',
    'Create at least one matching test file before completing.',
  ].join('\n');
}

/**
 * Main hook entrypoint.
 */
async function main(): Promise<void> {
  const hookInput = readHookInput();
  if (isNestedHookRun(hookInput)) {
    writeHookOutput({ continue: true });
    return;
  }

  resolveStaleIndirectViolations();

  const newSourceFiles = getNewSourceFiles();
  if (newSourceFiles.length === 0) {
    writeHookOutput({ continue: true });
    return;
  }

  const missing = newSourceFiles.filter((f) => !hasTestFile(f));
  if (missing.length === 0) {
    writeHookOutput({ continue: true });
    return;
  }

  const reason = buildBlockReason(missing);
  writeBlockingOutput({
    continue: true,
    systemMessage: reason,
    hookSpecificOutput: {
      hookEventName: 'sessionEnd',
      decision: 'block',
      reason: 'Missing test files for newly added source files',
    },
  });
}

main().catch(() => {
  writeHookOutput({ continue: true });
});
