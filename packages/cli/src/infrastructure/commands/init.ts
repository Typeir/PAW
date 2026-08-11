/**
 * PAW CLI — init / sync commands
 *
 * @fileoverview `paw init` attach PAW to current repo: write
 * `.paw/config.json` (host-agnostic descriptor: gates dir, connector) and a
 * `.git/hooks/pre-commit` that defer to `paw check --staged`. `paw sync` be
 * same in merge mode: re-apply non-destructively, keep whatever repo already
 * declare. Both be process shell around core's `applyInit`, the
 * attach use-case shared by `paw`, `paw-setup`, and console. `--dry-run`
 * plan and write nothing.
 *
 * @module @paw/cli/infrastructure/commands/init
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { applyInit, configPathFor, planInit, type InitMode } from '@paw/core';
import { createNodeFs } from '@paw/adapters';

/**
 * Walk up from directory to nearest git repository root.
 *
 * @param {string} start - Where to start looking.
 * @returns {string | null} Repo root, or null when not inside one.
 */
function findRepoRoot(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, '.git'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Attach or re-sync PAW to current repository.
 *
 * @param {string[]} rest - Words after `init` / `sync`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @param {InitMode} mode - `create` for init, `merge` for sync, `override` to replace.
 * @returns {Promise<number>} 0 on success, 1 when plan refused.
 */
export async function runInit(
  rest: string[],
  print: (lines: string[]) => void,
  mode: InitMode,
): Promise<number> {
  const dryRun = rest.includes('--dry-run');
  const label = mode === 'merge' ? 'sync' : 'init';
  const root = findRepoRoot(process.cwd());
  if (root === null) {
    throw new Error(`paw ${label}: not inside a git repository`);
  }
  const fs = createNodeFs();
  const existing = await fs.readText(configPathFor(root));
  const plan = dryRun
    ? planInit(root, existing === '' ? null : existing, mode)
    : await applyInit(root, fs, mode);
  const verb = dryRun ? 'would write' : 'wrote';
  print([
    `${label}: ${dryRun ? 'dry run · ' : ''}${root}`,
    ...plan.writes.map((write) => `  ${verb} ${write.path}`),
  ]);
  if (plan.refusal !== undefined) {
    print([`  refused: ${plan.refusal.reason}`]);
    return 1;
  }
  return 0;
}
