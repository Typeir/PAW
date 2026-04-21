/**
 * PAW Session End Health Hook
 *
 * @fileoverview Executes diff-scoped quality gates at session end and blocks
 * completion when critical violations are present. Calls pawGates.ts in
 * changed-only mode.
 *
 * @module .github/PAW/hooks/session-end-health
 * @author Typeir
 * @version 1.0.0
 * @since 3.0.0
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
    isNestedHookRun,
    readHookInput,
    writeBlockingOutput,
    writeHookOutput,
} from '../hook-runtime';
import { DEFAULT_DB_PATH, getPawConfig, openDbReadonly } from '../paw-db';
import {
    PAW_DIR,
    PAW_GATES_REL,
    PAW_TSCONFIG_REL,
    PROJECT_ROOT as ROOT,
} from '../paw-paths';

/**
 * Load optional sourceDirectories from .paw/config.json.
 * Falls back to empty array (= check all files, no path scoping).
 *
 * @returns {string[]} Directory paths for git diff scoping
 */
function loadSourceDirectories(): string[] {
  const configPath = path.join(PAW_DIR, 'config.json');
  if (!existsSync(configPath)) return [];
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    if (Array.isArray(config.sourceDirectories)) {
      return config.sourceDirectories.filter(
        (d: unknown) => typeof d === 'string',
      );
    }
  } catch {
    /* config parse failure — fall back to all files */
  }
  return [];
}

/**
 * Check whether tracked files have local changes.
 * Scopes to sourceDirectories from .paw/config.json when configured,
 * otherwise checks all tracked files.
 *
 * @returns {boolean} True when staged or unstaged changes exist
 */
function hasSourceChanges(): boolean {
  try {
    const dirs = loadSourceDirectories();
    const pathArgs = dirs.length > 0 ? ` -- ${dirs.join(' ')}` : '';
    const unstaged = execSync(`git diff --name-only HEAD${pathArgs}`, {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const staged = execSync(`git diff --cached --name-only${pathArgs}`, {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return unstaged.length > 0 || staged.length > 0;
  } catch {
    return false;
  }
}

/**
 * Parsed health report shape for decision-making.
 *
 * @interface ParsedReport
 * @property {string} overall - 'PASS' or 'FAIL'
 * @property {object} summary - Aggregate counters
 * @property {Array} gates - Per-gate results
 */
interface ParsedReport {
  overall: string;
  summary: {
    hasCritical?: boolean;
    totalFindings?: number;
  };
  gates: Array<{
    gate: string;
    passed: boolean;
    severity: string;
    findings: Array<{
      file?: string;
      line?: number;
      message: string;
      suggestion?: string;
    }>;
  }>;
}

/**
 * Extract JSON report from pawGates.ts output markers.
 *
 * @param output - Raw stdout from pawGates.ts
 * @returns Parsed report or null
 */
function parseJsonReport(output: string): ParsedReport | null {
  const startMarker = '---JSON_REPORT_START---';
  const endMarker = '---JSON_REPORT_END---';
  const startIdx = output.indexOf(startMarker);
  const endIdx = output.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) return null;

  try {
    const json = output.substring(startIdx + startMarker.length, endIdx).trim();
    return JSON.parse(json) as ParsedReport;
  } catch {
    return null;
  }
}

/**
 * Build actionable context from critical gate failures.
 *
 * @param report - Parsed health report
 * @returns Context string for the agent
 */
function buildActionableContext(report: ParsedReport): string {
  const failedGates = report.gates.filter(
    (g) => !g.passed && g.severity === 'critical',
  );
  if (failedGates.length === 0) {
    return '🚫 Health check failed but no specific failures were captured.';
  }

  const issuesByFile = new Map<
    string,
    Array<{ gate: string; message: string; line?: number; suggestion?: string }>
  >();

  for (const gate of failedGates) {
    for (const finding of gate.findings.slice(0, 15)) {
      const file = finding.file ?? gate.gate;
      if (!issuesByFile.has(file)) issuesByFile.set(file, []);
      issuesByFile.get(file)!.push({
        gate: gate.gate,
        message: finding.message,
        line: finding.line,
        suggestion: finding.suggestion,
      });
    }
  }

  const lines: string[] = ['🚫 Critical health check violations:\n'];
  for (const [file, issues] of issuesByFile) {
    lines.push(`📄 ${file}`);
    for (const issue of issues) {
      const loc = issue.line ? `:${issue.line}` : '';
      lines.push(`   [${issue.gate}] ${issue.message}${loc}`);
      if (issue.suggestion) lines.push(`   💡 ${issue.suggestion}`);
    }
    lines.push('');
  }

  lines.push('Fix these violations before completing the session.');
  return lines.join('\n');
}

/**
 * Main hook entrypoint.
 */
async function main(): Promise<void> {
  try {
    const cfgDb = await openDbReadonly(DEFAULT_DB_PATH);
    if (cfgDb) {
      try {
        if (getPawConfig(cfgDb, 'paw_state') === 'disabled') {
          writeHookOutput({ continue: true });
          return;
        }
      } finally {
        cfgDb.close();
      }
    }
  } catch {
    /* fail open */
  }

  const input = await readHookInput();
  if (isNestedHookRun(input)) {
    writeHookOutput({ continue: true });
    return;
  }

  if (!hasSourceChanges()) {
    writeHookOutput({ continue: true });
    return;
  }

  let output = '';
  let exitCode = 0;
  try {
    output = execSync(
      `npx tsx --tsconfig ${PAW_TSCONFIG_REL} ${PAW_GATES_REL} --changed-only`,
      {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 90000,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; status?: number };
    output = execErr.stdout ?? '';
    exitCode = execErr.status ?? 1;
  }

  const report = parseJsonReport(output);

  if (report?.summary?.hasCritical) {
    const context = buildActionableContext(report);
    writeBlockingOutput({
      continue: true,
      systemMessage: context,
      hookSpecificOutput: {
        hookEventName: 'sessionEnd',
        decision: 'block',
        reason: 'Critical health check violations in changed files',
      },
    });
  } else {
    writeHookOutput({ continue: true });
  }
}

main().catch(() => {
  writeHookOutput({ continue: true });
});
