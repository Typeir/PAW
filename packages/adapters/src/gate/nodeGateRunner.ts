/**
 * PAW Node Gate Runner
 *
 * @fileoverview A {@link GateRunner} that discovers a project's `.paw/gates/`,
 * loads each gate module, builds the single-file {@link GateContext} the legacy
 * `gateContext` produced, runs every gate, and assembles the {@link HealthReport}
 * the detector reads. Ported from the legacy `pawGates` + `gateContext`, narrowed
 * to the post-tool path: import-loadable gates over an explicit file set. Deferred
 * from main for now (each a clean later addition): subprocess-runner gates,
 * `dependsOn` ordering, and inline `paw:gate` suppression.
 *
 * @module @paw/adapters/gate/nodeGateRunner
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { execSync } from 'node:child_process';
import { existsSync, promises as fs, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  GateContext,
  GateResult,
  GateRunner,
  HealthReport,
  QualityGate,
} from '@paw/core';

const GATE_FILE = /\.gate\.(mts|cts|ts|mjs|cjs|js)$/;

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
      return [...changed].filter((f) => appliesTo.some((ext) => f.endsWith(ext)));
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
 * Discover and import the gates under a gates directory. A module that does not
 * export a `gate` with a `check` function is skipped, as in the legacy loader.
 *
 * @param {string} gatesDir - Absolute `.paw/gates` path.
 * @returns {Promise<QualityGate[]>} The loaded gates.
 */
async function loadGates(gatesDir: string): Promise<QualityGate[]> {
  if (!existsSync(gatesDir)) {
    return [];
  }
  const gates: QualityGate[] = [];
  for (const file of readdirSync(gatesDir).filter((f) => GATE_FILE.test(f))) {
    const url = pathToFileURL(path.join(gatesDir, file)).href;
    const mod = (await import(url)) as { gate?: QualityGate };
    if (mod.gate && typeof mod.gate.check === 'function') {
      gates.push(mod.gate);
    }
  }
  return gates;
}

/**
 * Run one gate, deriving `passed` from its findings and containing any throw as
 * a critical `gate-error` finding so a broken gate surfaces rather than crashing
 * the hook.
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
  const hasCritical = results.some(
    (r) => !r.passed && r.severity === 'critical',
  );
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
 * Create a {@link GateRunner} bound to a project root.
 *
 * @param {string} rootDir - Absolute project root; gates live under `.paw/gates`.
 * @returns {GateRunner} A runner that gates an explicit set of files.
 */
export function createNodeGateRunner(rootDir: string): GateRunner {
  return {
    async runForFiles(relativePaths: readonly string[]): Promise<HealthReport> {
      const gates = await loadGates(path.join(rootDir, '.paw', 'gates'));
      const context = singleFileContext(rootDir, relativePaths);
      const results: GateResult[] = [];
      for (const gate of gates) {
        results.push(await runGate(gate, context));
      }
      return assemble(results, relativePaths);
    },
  };
}
