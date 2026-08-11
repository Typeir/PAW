/**
 * PAW CLI — gates command.
 *
 * @fileoverview `paw gates` run repo quality gates, diff-scoped. Default to working-tree change set (unstaged + staged + untracked); `--staged` narrow to index for pre-commit check. Both feed `@paw/adapters` node runner pawd use on hook.
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
 * Run git command under root, return non-empty slash-normalised lines, or empty list when git missing or command fail.
 *
 * @param {string} root - repository root.
 * @param {readonly string[]} args - git arguments.
 * @returns {string[]} output lines.
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
 * Resolve diff-scoped file set: working-tree changes, or staged index.
 *
 * @param {string} root - repository root.
 * @param {'changed' | 'staged'} scope - which diff to resolve.
 * @returns {string[]} deduped, project-relative paths.
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
 * Run `gates` subcommand.
 *
 * @param {string[]} rest - words after `gates`.
 * @param {(lines: string[]) => void} print - line printer.
 * @returns {Promise<number>} 0 when every gate pass (or nothing changed), 1 on failure.
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
