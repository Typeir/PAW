/**
 * PAW Gate Execution
 *
 * @fileoverview Gate-run shared by cold {@link module:@paw/adapters/gate/nodeGateRunner}
 * and warm {@link module:@paw/adapters/gate/gateCache}. Build single-file
 * {@link GateContext}, run each gate (catch throw as critical
 * `gate-error`), assemble {@link HealthReport}. Gate-module loading —
 * import-per-call vs cache with mtime-invalidation — stay with each loader.
 * Downstream steps live here.
 *
 * @module @paw/adapters/gate/gateExec
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  GateContext,
  GateResult,
  HealthReport,
  QualityGate,
} from '@paw/core';

/**
 * Gate file names both loaders accept: import-loadable TS/JS modules.
 */
export const GATE_FILE = /\.gate\.(mts|cts|ts|mjs|cjs|js)$/;

/**
 * Build single-file context gate get, scoped to edited paths.
 *
 * @param {string} rootDir - Absolute project root.
 * @param {readonly string[]} relativePaths - Edited paths relative to root.
 * @returns {GateContext} Context, changed-only mode over those paths.
 */
function singleFileContext(
  rootDir: string,
  relativePaths: readonly string[],
): GateContext {
  const changed = new Set(relativePaths.map((f) => f.replace(/\\/g, '/')));
  const cache = new Map<string, string>();
  return {
    rootDir,
    mode: 'changed-only',
    changedFiles: changed,
    staged: false,
    async targetFiles(appliesTo: string[]): Promise<string[]> {
      const matched = [...changed].filter((f) =>
        appliesTo.some((ext) => f.endsWith(ext)),
      );
      const existing: string[] = [];
      for (const f of matched) {
        try {
          await fs.access(path.join(rootDir, f));
          existing.push(f);
        } catch {
          /* deleted since edit — nothing left to check, not gate error */
        }
      }
      return existing;
    },
    async readFile(relativePath: string): Promise<string> {
      const norm = relativePath.replace(/\\/g, '/');
      const hit = cache.get(norm);
      if (hit !== undefined) {
        return hit;
      }
      const content = await fs.readFile(path.join(rootDir, relativePath), 'utf-8');
      cache.set(norm, content);
      return content;
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

/**
 * Run one gate. Derive `passed` from its findings; contain any throw as
 * critical `gate-error`.
 *
 * @param {QualityGate} gate - Gate to run.
 * @param {GateContext} context - Shared context.
 * @returns {Promise<GateResult>} Gate's result.
 */
async function runGate(
  gate: QualityGate,
  context: GateContext,
): Promise<GateResult> {
  const start = performance.now();
  try {
    const result = await gate.check(context);
    const findings = result.findings ?? [];
    return {
      gate: gate.id,
      passed: findings.length === 0,
      severity: result.severity,
      findings,
      stats: {
        filesChecked: result.stats?.filesChecked ?? 0,
        findingsCount: findings.length,
        durationMs: Math.round(performance.now() - start),
      },
    };
  } catch (err: unknown) {
    return {
      gate: gate.id,
      passed: false,
      severity: 'critical',
      findings: [
        {
          file: gate.id,
          rule: 'gate-error',
          message: (err instanceof Error ? err.message : String(err)).slice(0, 300),
          suggestion: 'Check gate implementation',
        },
      ],
      stats: {
        filesChecked: 0,
        findingsCount: 1,
        durationMs: Math.round(performance.now() - start),
      },
    };
  }
}

/**
 * Assemble report from per-gate results.
 *
 * @param {GateResult[]} results - Gate results.
 * @param {readonly string[]} relativePaths - Gated paths.
 * @returns {HealthReport} Aggregate report.
 */
function assemble(
  results: GateResult[],
  relativePaths: readonly string[],
): HealthReport {
  const hasCritical = results.some((r) => !r.passed && r.severity === 'critical');
  return {
    timestamp: new Date().toISOString(),
    mode: 'changed-only',
    changedFiles: relativePaths.map((f) => f.replace(/\\/g, '/')),
    overall: hasCritical ? 'FAIL' : 'PASS',
    summary: {
      totalGates: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      totalFindings: results.reduce((n, r) => n + r.findings.length, 0),
      hasCritical,
    },
    gates: results,
  };
}

/**
 * Run already-loaded gates against edited files, assemble report.
 * Shared by both loaders.
 *
 * @param {string} rootDir - Absolute project root.
 * @param {readonly string[]} relativePaths - Edited paths relative to root.
 * @param {readonly QualityGate[]} gates - Gates to run.
 * @returns {Promise<HealthReport>} Report.
 */
export async function executeGates(
  rootDir: string,
  relativePaths: readonly string[],
  gates: readonly QualityGate[],
): Promise<HealthReport> {
  const context = singleFileContext(rootDir, relativePaths);
  const results: GateResult[] = [];
  for (const gate of gates) {
    results.push(await runGate(gate, context));
  }
  return assemble(results, relativePaths);
}
