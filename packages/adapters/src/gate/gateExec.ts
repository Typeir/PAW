/**
 * PAW Gate Execution
 *
 * @fileoverview The gate-running the cold {@link module:@paw/adapters/gate/nodeGateRunner}
 * and the warm {@link module:@paw/adapters/gate/gateCache} share: building the
 * single-file {@link GateContext}, running each gate (containing a throw as a
 * critical `gate-error`), and assembling the {@link HealthReport}. The two differ
 * only in how they load the gate modules — import-per-call vs cache with
 * mtime-invalidation — so that stays with each; everything downstream is here.
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
 * The gate file names both loaders accept: import-loadable TS/JS modules.
 */
export const GATE_FILE = /\.gate\.(mts|cts|ts|mjs|cjs|js)$/;

/**
 * Build the single-file context a gate receives, scoped to the edited paths.
 *
 * @param {string} rootDir - Absolute project root.
 * @param {readonly string[]} relativePaths - Edited paths relative to the root.
 * @returns {GateContext} The context, in changed-only mode over those paths.
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
          /* deleted since the edit — nothing left to check, not a gate error */
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
 * Run one gate, deriving `passed` from its findings and containing any throw as a
 * critical `gate-error` so a broken gate surfaces rather than crashing the run.
 *
 * @param {QualityGate} gate - The gate to run.
 * @param {GateContext} context - The shared context.
 * @returns {Promise<GateResult>} The gate's result.
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
 * Assemble the report from per-gate results.
 *
 * @param {GateResult[]} results - The gate results.
 * @param {readonly string[]} relativePaths - The gated paths.
 * @returns {HealthReport} The aggregate report.
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
 * Run a set of already-loaded gates against the edited files and assemble the
 * report — the half both loaders share.
 *
 * @param {string} rootDir - Absolute project root.
 * @param {readonly string[]} relativePaths - Edited paths relative to the root.
 * @param {readonly QualityGate[]} gates - The gates to run.
 * @returns {Promise<HealthReport>} The report.
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
