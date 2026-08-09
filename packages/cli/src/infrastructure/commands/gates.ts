/**
 * PAW CLI — gates command
 *
 * @fileoverview `paw gates` runs this repository's quality gates on demand. It is
 * deliberately diff-scoped — a full-repo scan takes minutes and is what CI is
 * for, so it is not offered here. The default is the working-tree change set
 * (unstaged + staged + untracked); `--staged` narrows to the index for a
 * pre-commit check. Both feed the same `@paw/adapters` node runner pawd uses on
 * a hook, so a manual run and an enforced one agree.
 *
 * @module @paw/cli/infrastructure/commands/gates
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { execFileSync } from 'node:child_process';
import { createNodeGateRunner } from '@paw/adapters';
import { parseArgs } from '../../domain/context.js';
import { formatGateReport } from '../../domain/format.js';

/**
 * Run a git command under a root and return its non-empty, slash-normalised
 * lines, or an empty list when git is unavailable or the command fails.
 *
 * @param {string} root - The repository root.
 * @param {readonly string[]} args - The git arguments.
 * @returns {string[]} The output lines.
 */
function gitLines(root: string, args: readonly string[]): string[] {
  try {
    return execFileSync('git', [...args], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim().replace(/\\/g, '/'))
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/**
 * Resolve the diff-scoped file set: the working-tree changes, or the staged index.
 *
 * @param {string} root - The repository root.
 * @param {'changed' | 'staged'} scope - Which diff to resolve.
 * @returns {string[]} Deduped, project-relative paths.
 */
function resolveFiles(root: string, scope: 'changed' | 'staged'): string[] {
  if (scope === 'staged') {
    return [...new Set(gitLines(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR']))];
  }
  return [
    ...new Set([
      ...gitLines(root, ['diff', '--name-only', 'HEAD']),
      ...gitLines(root, ['diff', '--cached', '--name-only']),
      ...gitLines(root, ['ls-files', '--others', '--exclude-standard']),
    ]),
  ];
}

/**
 * Run the `gates` subcommand.
 *
 * @param {string[]} rest - The words after `gates`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} 0 when every gate passed (or nothing changed), 1 on failure.
 */
export async function runGates(
  rest: string[],
  print: (lines: string[]) => void,
): Promise<number> {
  const args = parseArgs(rest, []);
  const scope = args.flags.has('staged') ? 'staged' : 'changed';
  const root = process.cwd();
  const files = resolveFiles(root, scope);
  if (files.length === 0) {
    print([`gates: nothing ${scope} to check`]);
    return 0;
  }
  const report = await createNodeGateRunner(root).runForFiles(files);
  print(formatGateReport(report));
  return report.overall === 'PASS' ? 0 : 1;
}
