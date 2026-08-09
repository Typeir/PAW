/**
 * PAW CLI — init / sync commands
 *
 * @fileoverview `paw init` attaches PAW to the repository you are in — it writes
 * `.paw/config.json` (the host-agnostic descriptor: gates dir, connector) and a
 * `.git/hooks/pre-commit` that defers to `paw check --staged`. `paw sync` is the
 * same in merge mode: re-apply non-destructively, keeping whatever the repo has
 * already declared. Both are the process shell around core's `applyInit` — the
 * one attach use-case that `paw`, `paw-setup`, and the console all share, so they
 * cannot drift. `--dry-run` plans and writes nothing.
 *
 * @module @paw/cli/commands/init
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { applyInit, configPathFor, planInit, type InitMode } from '@paw/core';
import { createNodeFs } from '@paw/adapters';

/**
 * Walk up from a directory to the nearest git repository root.
 *
 * @param {string} start - Where to start looking.
 * @returns {string | null} The repo root, or null when not inside one.
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
 * Attach or re-sync PAW to the current repository.
 *
 * @param {string[]} rest - The words after `init` / `sync`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @param {InitMode} mode - `create` for init, `merge` for sync, `override` to replace.
 * @returns {Promise<number>} 0 on success, 1 when the plan refused.
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
