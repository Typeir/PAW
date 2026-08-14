/**
 * PAW Linter Connectors
 *
 * @fileoverview Pure half of the linter connectors: the command each linter
 * runs and the parser that turns its output into findings. Execution and
 * violation recording live behind seams in the enforcement daemon. Every
 * linter finding is deferred severity — recorded as an indirect violation,
 * never critical — so the operator acts on them later in any order.
 *
 * @module @paw/core/domain/linters
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { Violation } from './violation.js';

/**
 * One linter finding, addressed to a file.
 *
 * @interface LintFinding
 * @property {string} filePath - File the finding is on, forward slashes.
 * @property {number} line - 1-based line, 0 when the tool gave none.
 * @property {string} rule - `tsc/TSxxxx` or `eslint/<ruleId>`.
 * @property {string} message - The tool's message.
 */
export interface LintFinding {
  readonly filePath: string;
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}

/**
 * Command a linter connector runs. `bin` is the tool's own name; where that
 * binary lives is the adapter's business.
 *
 * @interface LinterCommand
 * @property {string} bin - Tool name, e.g. `eslint`.
 * @property {readonly string[]} args - Arguments, touched files appended where the tool scopes per file.
 */
export interface LinterCommand {
  readonly bin: string;
  readonly args: readonly string[];
}

/**
 * Command for a linter connector, or null for an id that is not a linter.
 * tsc checks the whole project — it cannot type-check one file in isolation —
 * while eslint scopes to the touched files.
 *
 * @param {string} id - Connector id.
 * @param {readonly string[]} files - Touched files, repo-relative.
 * @returns {LinterCommand | null} The command, or null.
 */
export function linterCommandFor(id: string, files: readonly string[]): LinterCommand | null {
  if (id === 'tsc') {
    return { bin: 'tsc', args: ['--noEmit', '--pretty', 'false'] };
  }
  if (id === 'eslint') {
    return { bin: 'eslint', args: ['--format', 'json', ...files] };
  }
  return null;
}

/**
 * Linter finding as an unrecorded violation. Always `indirectFix`: a linter
 * finding nudges on the next tool call and never denies one, so the operator
 * clears them in any order. The store carries no line number, so the line
 * rides in the message.
 *
 * @param {LintFinding} finding - The finding.
 * @returns {Violation} Deferred violation to raise.
 */
export function lintViolation(finding: LintFinding): Violation {
  return {
    id: 0,
    filePath: finding.filePath,
    rule: finding.rule,
    message: finding.line > 0 ? `${finding.message} (line ${finding.line})` : finding.message,
    indirectFix: true,
  };
}

const TSC_LINE = /^(.+?)\((\d+),\d+\):\s+error\s+(TS\d+):\s+(.*)$/;

/**
 * Findings in `tsc --noEmit --pretty false` output. Lines that are not
 * diagnostics are skipped.
 *
 * @param {string} stdout - Compiler output.
 * @returns {LintFinding[]} One finding per diagnostic line.
 */
export function parseTscOutput(stdout: string): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = TSC_LINE.exec(line.trim());
    if (match) {
      findings.push({
        filePath: match[1].replace(/\\/g, '/'),
        line: Number(match[2]),
        rule: `tsc/${match[3]}`,
        message: match[4],
      });
    }
  }
  return findings;
}

/**
 * Findings in `eslint --format json` output. Output that is not the expected
 * JSON reads as no findings — a linter that exploded must not fabricate
 * violations.
 *
 * @param {string} stdout - ESLint JSON output.
 * @returns {LintFinding[]} One finding per message.
 */
export function parseEslintJson(stdout: string): LintFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const findings: LintFinding[] = [];
  for (const file of parsed as {
    filePath?: unknown;
    messages?: { ruleId?: unknown; line?: unknown; message?: unknown }[];
  }[]) {
    if (typeof file.filePath !== 'string' || !Array.isArray(file.messages)) {
      continue;
    }
    for (const msg of file.messages) {
      findings.push({
        filePath: file.filePath.replace(/\\/g, '/'),
        line: typeof msg.line === 'number' ? msg.line : 0,
        rule: `eslint/${typeof msg.ruleId === 'string' ? msg.ruleId : 'parse'}`,
        message: typeof msg.message === 'string' ? msg.message : '',
      });
    }
  }
  return findings;
}
