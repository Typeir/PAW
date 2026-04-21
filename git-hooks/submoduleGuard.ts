#!/usr/bin/env npx tsx --tsconfig tsconfig.scripts.json

/**
 * Submodule Staging Guard
 *
 * @fileoverview Blocks commits that include staged files inside the
 * content submodule directory (src/content). Those changes should be
 * committed in the content repository instead. Skipped when
 * IK_RUNNING=1 (multirepo coordinator intentionally stages the
 * submodule pointer).
 *
 * Extracted from the former pre-commit.ts to run as a standalone hook
 * step appended to the PAW pre-commit shim.
 *
 * @module .github/PAW/git-hooks/submodule-guard
 * @author Typeir
 * @version 1.0.0
 * @since 3.0.0
 */

import { execSync } from 'child_process';

/**
 * Content submodule path (relative to repo root).
 * Staged files under this path should be committed in the content repo.
 */
const SUBMODULE_PATH = 'src/content';

/**
 * Gets the list of staged files from git.
 *
 * @returns {string[]} Array of relative staged file paths
 */
function getStagedFiles(): string[] {
  try {
    const output = execSync('git diff --cached --name-only', {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return output.split('\n').filter(Boolean);
  } catch {
    console.error('❌ Error reading staged files');
    process.exit(1);
  }
}

/**
 * Checks whether any staged files reside inside the content submodule directory.
 * If so, prints an error message and exits with code 1.
 */
function runSubmoduleGuard(): void {
  if (process.env.IK_RUNNING === '1') {
    return;
  }

  const stagedFiles = getStagedFiles();
  const submodulePrefix = SUBMODULE_PATH.replace(/\\/g, '/');
  const violations = stagedFiles.filter(
    (f) => f.startsWith(submodulePrefix + '/') || f === submodulePrefix,
  );

  if (violations.length === 0) {
    return;
  }

  const fileList = violations.map((file) => `  📄 ${file}`).join('\n');
  console.error(
    '\n❌ SUBMODULE GUARD FAILED\n\n' +
      'You have staged changes inside the content submodule (' +
      SUBMODULE_PATH +
      ').\n' +
      'Commit them in the content repo instead.\n\n' +
      fileList,
  );
  process.exit(1);
}

runSubmoduleGuard();
