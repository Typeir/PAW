/**
 * PAW Linter Runner
 *
 * @fileoverview Executing half of the linter connectors. Reads which
 * connectors are enabled per call, so enabling one in a surface takes effect
 * on the next edit without a daemon restart.
 *
 * Two execution shapes. ESLint scopes to the touched files and runs inline
 * within the hook budget. `tsc` type-checks the whole project — it cannot
 * check one file in isolation — which is far slower than the 8s RPC budget,
 * so it runs detached, single-flight, and its findings land later through
 * `onLate`; findings are scoped to the touched files, because the violation
 * store answers "what did this edit break", not "what does the project owe".
 *
 * A linter that exits non-zero is reporting findings, not failing: the exec
 * seam resolves with stdout for any exit code and rejects only when the
 * process could not run at all. Binaries resolve to the repo's own
 * `node_modules/.bin` and run without a shell, so a filename an agent chose
 * cannot become a shell command.
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
 * Run one command and resolve with its stdout, whatever its exit code.
 * Rejects only when the process could not be started or timed out.
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
 * Each tool's JS entry inside its own package. The `.bin` shims are not
 * usable here: node refuses to execute a Windows `.cmd` without a shell, and
 * a shell would let a filename an agent chose become a command. Running the
 * entry under this node binary is both shell-free and cross-platform.
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
   * Start the detached whole-project run unless one is already in flight.
   * Findings are scoped to the files this edit touched and handed to
   * `onLate`. Every failure is swallowed: a linter that cannot run must not
   * disturb the enforcement loop.
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
