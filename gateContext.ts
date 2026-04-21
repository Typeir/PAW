/**
 * PAW Gate Context
 *
 * @fileoverview Builds the GateContext that every gate receives. Handles file
 * discovery, caching, git operations, and mode-aware scoping (full vs changed-only
 * vs staged).
 *
 * @module .github/PAW/gate-context
 * @author Typeir
 * @version 1.0.0
 * @since 3.0.0
 */

import { execSync } from 'node:child_process';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import type { GateContext } from './healthCheckTypes';

/**
 * Default patterns to exclude when no .pawignore file is present.
 */
const DEFAULT_EXCLUDES = [
  'node_modules',
  '.next',
  '.git',
  'coverage',
  'dist',
  '.turbo',
];

/**
 * Load exclude patterns from .pawignore (one glob per line, # for comments).
 * Falls back to DEFAULT_EXCLUDES if the file doesn't exist.
 *
 * @param rootDir - Project root
 * @returns Array of RegExp patterns to test against relative paths
 */
function loadExcludePatterns(rootDir: string): RegExp[] {
  const ignorePath = path.join(rootDir, '.pawignore');
  const lines = existsSync(ignorePath)
    ? readFileSync(ignorePath, 'utf-8').split('\n')
    : DEFAULT_EXCLUDES;

  return lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
    .map((pattern) => {
      const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
      return new RegExp(escaped);
    });
}

/**
 * Check whether a relative path is excluded by .pawignore patterns.
 *
 * @param relativePath - Path relative to project root
 * @param excludes - Compiled exclude patterns
 * @returns True when the path should be excluded
 */
function isExcludedPath(relativePath: string, excludes: RegExp[]): boolean {
  return excludes.some((pattern) => pattern.test(relativePath));
}

/**
 * Apply .pawignore exclusions to a changed file set.
 *
 * @param changedFiles - Changed files to filter
 * @param excludes - Compiled exclude patterns
 * @returns Filtered changed file set
 */
function filterChangedFiles(
  changedFiles: Set<string> | null,
  excludes: RegExp[],
): Set<string> | null {
  if (!changedFiles) return null;

  return new Set(
    [...changedFiles]
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => !isExcludedPath(f, excludes)),
  );
}

/**
 * Get the set of changed files relative to rootDir.
 * Includes unstaged, staged, and untracked files.
 *
 * @param rootDir - Project root
 * @returns Set of relative file paths with forward slashes
 */
function getChangedFiles(rootDir: string): Set<string> {
  const run = (cmd: string, cwd: string = rootDir): string => {
    try {
      return execSync(cmd, {
        cwd,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      return '';
    }
  };

  const lines = [
    run('git diff --name-only HEAD'),
    run('git diff --cached --name-only'),
    run('git ls-files --others --exclude-standard'),
  ]
    .filter(Boolean)
    .join('\n')
    .split('\n')
    .filter(Boolean)
    .map((f) => f.replace(/\\/g, '/'));

  /** Auto-discover git submodules and collect their changed files */
  const submodulePaths = discoverSubmodules(rootDir, run);
  for (const subPath of submodulePaths) {
    const absSubPath = path.join(rootDir, subPath);
    try {
      const subLines = [
        run('git diff --name-only HEAD', absSubPath),
        run('git diff --cached --name-only', absSubPath),
        run('git ls-files --others --exclude-standard', absSubPath),
      ]
        .filter(Boolean)
        .join('\n')
        .split('\n')
        .filter(Boolean)
        .map((f) => `${subPath}/${f.replace(/\\/g, '/')}`);

      for (const line of subLines) lines.push(line);
    } catch {
      /** Submodule may not be initialized */
    }
  }

  return new Set(lines);
}

/**
 * Discover git submodule paths relative to rootDir.
 * Parses `git submodule status` output to find registered submodules.
 *
 * @param rootDir - Project root
 * @param run - Command runner function
 * @returns Array of relative submodule paths
 */
function discoverSubmodules(
  rootDir: string,
  run: (cmd: string, cwd?: string) => string,
): string[] {
  const output = run('git submodule status', rootDir);
  if (!output) return [];

  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line
        .trim()
        .replace(/^[-+ ]/, '')
        .split(/\s+/);
      return parts[1]?.replace(/\\/g, '/');
    })
    .filter((p): p is string => Boolean(p));
}

/**
 * Get the set of staged files only (for pre-commit hooks).
 *
 * @param rootDir - Project root
 * @returns Set of relative file paths with forward slashes
 */
function getStagedFiles(rootDir: string): Set<string> {
  try {
    const output = execSync(
      'git diff --cached --name-only --diff-filter=ACMR',
      {
        cwd: rootDir,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ).trim();

    return new Set(
      output
        .split('\n')
        .filter(Boolean)
        .map((f) => f.replace(/\\/g, '/')),
    );
  } catch {
    return new Set();
  }
}

/**
 * Recursively walk a directory and collect file paths.
 *
 * @param dir - Directory to walk
 * @param rootDir - Project root for computing relative paths
 * @param extensions - File extensions to include
 * @param excludes - Exclude patterns loaded from .pawignore
 * @param results - Accumulator
 * @returns Relative file paths with forward slashes
 */
async function walkDir(
  dir: string,
  rootDir: string,
  extensions: string[],
  excludes: RegExp[],
  results: string[] = [],
): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(rootDir, full).replace(/\\/g, '/');

    if (excludes.some((pattern) => pattern.test(rel))) continue;

    if (entry.isDirectory()) {
      await walkDir(full, rootDir, extensions, excludes, results);
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(rel);
    }
  }

  return results;
}

/**
 * Build a GateContext from runtime flags.
 *
 * @param rootDir - Absolute path to the project root
 * @param mode - 'full' or 'changed-only'
 * @param staged - Whether to scope to staged files only (--staged flag)
 * @returns A ready-to-use GateContext
 */
export function buildGateContext(
  rootDir: string,
  mode: 'full' | 'changed-only',
  staged: boolean = false,
): GateContext {
  const changedFiles =
    mode === 'changed-only'
      ? staged
        ? getStagedFiles(rootDir)
        : getChangedFiles(rootDir)
      : null;

  return buildGateContextImpl(rootDir, mode, staged, changedFiles);
}

/**
 * Build a GateContext scoped to an explicit set of files.
 * Used by the post-tool-use hook to run gates against a single edited file.
 *
 * @param rootDir - Absolute path to the project root
 * @param relativePaths - File paths relative to rootDir (forward-slash separated)
 * @returns A GateContext in changed-only mode scoped to the given files
 */
export function buildSingleFileContext(
  rootDir: string,
  relativePaths: string[],
): GateContext {
  const changedFiles = new Set(relativePaths.map((f) => f.replace(/\\/g, '/')));
  return buildGateContextImpl(rootDir, 'changed-only', false, changedFiles);
}

/**
 * Internal GateContext builder shared by both public factory functions.
 *
 * @param rootDir - Absolute path to the project root
 * @param mode - Execution scope
 * @param staged - Whether scoped to staging area
 * @param changedFiles - Pre-resolved changed file set (null = full scan)
 * @returns A ready-to-use GateContext
 */
function buildGateContextImpl(
  rootDir: string,
  mode: 'full' | 'changed-only',
  staged: boolean,
  changedFiles: Set<string> | null,
): GateContext {
  const fileCache = new Map<string, string>();
  const excludes = loadExcludePatterns(rootDir);
  const filteredChangedFiles = filterChangedFiles(changedFiles, excludes);

  return {
    rootDir,
    mode,
    changedFiles: filteredChangedFiles,
    staged,

    async targetFiles(
      appliesTo: string[],
      scanDirs: string[] = ['src'],
    ): Promise<string[]> {
      if (mode === 'changed-only' && filteredChangedFiles) {
        return [...filteredChangedFiles].filter((f) =>
          appliesTo.some((ext) => f.endsWith(ext)),
        );
      }

      const allFiles: string[] = [];
      for (const dir of scanDirs) {
        const abs = path.join(rootDir, dir);
        await walkDir(abs, rootDir, appliesTo, excludes, allFiles);
      }
      return allFiles;
    },

    async readFile(relativePath: string): Promise<string> {
      const normalized = relativePath.replace(/\\/g, '/');
      if (!fileCache.has(normalized)) {
        const content = await fs.readFile(
          path.join(rootDir, relativePath),
          'utf-8',
        );
        fileCache.set(normalized, content);
      }
      return fileCache.get(normalized)!;
    },

    git(command: string): string {
      return execSync(`git ${command}`, {
        cwd: rootDir,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    },
  };
}
