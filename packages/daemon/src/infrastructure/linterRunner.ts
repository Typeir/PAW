/**
 * PAW Linter Runner
 *
 * @fileoverview Runs the enabled linter connectors. Enabled ids are read per
 * call. ESLint runs inline on the touched files; `tsc` is whole-project and
 * slower than the hook budget, so it runs detached and single-flight, and its
 * findings reach `onLate` scoped to the touched files. Tools run as their own
 * JS entry under node: no shell, so a filename cannot become a command.
 *
 * @module @paw/daemon/infrastructure/linterRunner
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import {
  linterCommandFor,
  parseEslintJson,
  parseTscOutput,
  toProjectRelative,
  type LintFinding,
  type LinterRunner,
} from '@paw/core';

/**
 * Files a linter connector reads.
 */
const LINTABLE = /\.(?:[cm]?[jt]sx?)$/;

/**
 * How long an inline linter may take before it is abandoned.
 */
export const INLINE_TIMEOUT_MS = 5_000;

/**
 * How long the whole-project run may take before it is abandoned.
 */
export const PROJECT_TIMEOUT_MS = 180_000;

/**
 * Runs one command, resolving with stdout whatever the exit code. Rejects
 * only when the process could not start or timed out.
 *
 * @callback LintExec
 * @param {string} cmd - Executable.
 * @param {readonly string[]} args - Arguments.
 * @param {string} cwd - Working directory.
 * @param {number} timeoutMs - Abandon after this long.
 * @returns {Promise<string>} Captured stdout.
 */
export type LintExec = (
  cmd: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
) => Promise<string>;

/**
 * Default exec over `node:child_process`.
 *
 * @param {string} cmd - Executable.
 * @param {readonly string[]} args - Arguments.
 * @param {string} cwd - Working directory.
 * @param {number} timeoutMs - Abandon after this long.
 * @returns {Promise<string>} Captured stdout.
 */
export const nodeLintExec: LintExec = (cmd, args, cwd, timeoutMs) =>
  new Promise((resolvePromise, rejectPromise) => {
    execFile(
      cmd,
      [...args],
      { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (err !== null && stdout === '') {
          rejectPromise(err);
          return;
        }
        resolvePromise(stdout);
      },
    );
  });

/**
 * Each tool's JS entry inside its own package. The `.bin` shims are unusable:
 * node refuses to execute a Windows `.cmd` without a shell.
 */
const TOOL_ENTRIES: Readonly<Record<string, string>> = {
  eslint: join('eslint', 'bin', 'eslint.js'),
  tsc: join('typescript', 'bin', 'tsc'),
};

/**
 * Where a tool's JS entry lives in the repo, or null when the tool has no
 * known entry.
 *
 * @param {string} root - Repository root.
 * @param {string} bin - Tool name.
 * @returns {string | null} Absolute entry path, or null.
 */
export function toolEntry(root: string, bin: string): string | null {
  const rel = TOOL_ENTRIES[bin];
  return rel === undefined ? null : join(root, 'node_modules', rel);
}

/**
 * What the runner needs.
 *
 * @interface LinterRunnerOptions
 * @property {string} root - Repository root; linters run here and paths resolve against it.
 * @property {() => readonly string[] | Promise<readonly string[]>} enabled - Enabled connector ids, read per run.
 * @property {LintExec} [exec] - Command execution seam.
 * @property {(findings: readonly LintFinding[]) => void} [onLate] - Receive findings from the detached whole-project run.
 * @property {number} [inlineTimeoutMs] - Override {@link INLINE_TIMEOUT_MS}.
 * @property {number} [projectTimeoutMs] - Override {@link PROJECT_TIMEOUT_MS}.
 */
export interface LinterRunnerOptions {
  readonly root: string;
  enabled(): readonly string[] | Promise<readonly string[]>;
  readonly exec?: LintExec;
  onLate?(findings: readonly LintFinding[]): void;
  readonly inlineTimeoutMs?: number;
  readonly projectTimeoutMs?: number;
}

/**
 * Normalise a path a linter reported to a repo-relative one.
 *
 * @param {string} root - Repository root.
 * @param {string} path - Path as the tool reported it.
 * @returns {string} Repo-relative path, forward slashes.
 */
function relativise(root: string, path: string): string {
  return toProjectRelative(root, path).replace(/^\.\//, '');
}

/**
 * Build the linter runner for one repository.
 *
 * @param {LinterRunnerOptions} options - Root, enabled-state source, and seams.
 * @returns {LinterRunner} The runner.
 */
export function createLinterRunner(options: LinterRunnerOptions): LinterRunner {
  const exec = options.exec ?? nodeLintExec;
  const inlineMs = options.inlineTimeoutMs ?? INLINE_TIMEOUT_MS;
  const projectMs = options.projectTimeoutMs ?? PROJECT_TIMEOUT_MS;
  let projectRunning = false;

  /**
   * Start the detached whole-project run unless one is in flight. Findings go
   * to `onLate`, scoped to `files`. Failures are swallowed.
   *
   * @param {readonly string[]} files - Touched files, repo-relative.
   */
  const startProjectRun = (files: readonly string[]): void => {
    const onLate = options.onLate;
    if (projectRunning || onLate === undefined) {
      return;
    }
    const command = linterCommandFor('tsc', files);
    const entry = command === null ? null : toolEntry(options.root, command.bin);
    if (command === null || entry === null) {
      return;
    }
    projectRunning = true;
    const touched = new Set(files);
    void exec(process.execPath, [entry, ...command.args], options.root, projectMs)
      .then((stdout) => {
        const scoped = parseTscOutput(stdout)
          .map((finding) => ({ ...finding, filePath: relativise(options.root, finding.filePath) }))
          .filter((finding) => touched.has(finding.filePath));
        if (scoped.length > 0) {
          onLate(scoped);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        projectRunning = false;
      });
  };

  return {
    runForFiles: async (relativePaths: readonly string[]): Promise<readonly LintFinding[]> => {
      const files = relativePaths.filter((path) => LINTABLE.test(path));
      if (files.length === 0) {
        return [];
      }
      const ids = new Set(await options.enabled());
      const findings: LintFinding[] = [];

      if (ids.has('eslint')) {
        const command = linterCommandFor('eslint', files);
        const entry = command === null ? null : toolEntry(options.root, command.bin);
        if (command !== null && entry !== null) {
          try {
            const stdout = await exec(
              process.execPath,
              [entry, ...command.args],
              options.root,
              inlineMs,
            );
            for (const finding of parseEslintJson(stdout)) {
              findings.push({ ...finding, filePath: relativise(options.root, finding.filePath) });
            }
          } catch {}
        }
      }

      if (ids.has('tsc')) {
        startProjectRun(files);
      }

      return findings;
    },
  };
}
