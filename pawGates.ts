/**
 * PAW Gate Orchestrator
 *
 * @fileoverview Discovers gates from .paw/gates/ by filesystem convention,
 * resolves dependency order, builds a GateContext, runs gates, and emits a
 * HealthReport as both human-readable console output and machine-readable JSON.
 *
 * CLI flags:
 *   --changed-only   Scope to files changed since HEAD
 *   --staged         Scope to files in the git staging area (implies --changed-only)
 *   --gates a,b,c    Run only named gates
 *   --port name      Run only gates in a logical port
 *
 * @module .github/PAW/pawGates
 * @author Typeir
 * @version 1.0.0
 * @since 3.0.0
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildGateContext, buildSingleFileContext } from './gate-context';
import { filterGateFindings } from './gate-ignore';
import type {
    GateContext,
    GatePort,
    GateResult,
    HealthReport,
    QualityGate,
} from './health-check-types';
import * as logger from './paw-logger';
import { GATES_DIR, PAW_CONFIG_PATH, PROJECT_ROOT as ROOT } from './paw-paths';

/**
 * Parse CLI arguments into structured options.
 *
 * @returns Parsed flags
 */
function parseArgs(): {
  mode: 'full' | 'changed-only';
  staged: boolean;
  gateNames: string[] | undefined;
  port: GatePort | undefined;
} {
  const args = process.argv.slice(2);
  const staged = args.includes('--staged');
  const changedOnly = args.includes('--changed-only') || staged;

  let gateNames: string[] | undefined;
  const gatesIdx = args.indexOf('--gates');
  if (gatesIdx !== -1 && args[gatesIdx + 1]) {
    gateNames = args[gatesIdx + 1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  let port: GatePort | undefined;
  const portIdx = args.indexOf('--port');
  if (portIdx !== -1 && args[portIdx + 1]) {
    port = args[portIdx + 1] as GatePort;
  }

  return {
    mode: changedOnly ? 'changed-only' : 'full',
    staged,
    gateNames,
    port,
  };
}

/**
 * Gate runner configuration mapping file extensions to execution strategies.
 * `"import"` means in-process dynamic import (fast, TypeScript only).
 * Any other string is treated as a subprocess command (e.g. `"node"`, `"python3"`).
 *
 * @typedef {Record<string, string>} RunnerMap
 */
type RunnerMap = Record<string, string>;

/**
 * Default runner map when no config is provided. Only TypeScript gates
 * are supported out of the box via in-process import.
 */
const DEFAULT_RUNNERS: RunnerMap = { '.gate.ts': 'import' };

/**
 * Load gate runner configuration from .paw/config.json.
 * Falls back to DEFAULT_RUNNERS when no config exists or runners key is absent.
 *
 * @returns Runner extension-to-command mapping
 */
function loadRunnerConfig(): RunnerMap {
  if (!existsSync(PAW_CONFIG_PATH)) return DEFAULT_RUNNERS;
  try {
    const raw = readFileSync(PAW_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);
    if (config.runners && typeof config.runners === 'object') {
      return config.runners as RunnerMap;
    }
  } catch {
    /* parse failure — use defaults */
  }
  return DEFAULT_RUNNERS;
}

/**
 * Get the runner suffix that matches a gate filename.
 * E.g. `"my-check.gate.py"` matches `".gate.py"`.
 *
 * @param filename - Gate filename
 * @param runners - Runner map
 * @returns Matching suffix key or null
 */
function matchRunner(filename: string, runners: RunnerMap): string | null {
  for (const suffix of Object.keys(runners)) {
    if (filename.endsWith(suffix)) return suffix;
  }
  return null;
}

/**
 * Execute a gate as a subprocess. Passes a serialised context object on
 * stdin and expects a JSON {@link GateResult} on stdout.
 *
 * @param runner - Executable command (e.g. `"python3"`, `"node"`)
 * @param gatePath - Absolute path to the gate script
 * @param context - Gate context to serialise for the subprocess
 * @returns Parsed GateResult from subprocess stdout
 */
function runSubprocessGate(
  runner: string,
  gatePath: string,
  context: GateContext,
): GateResult {
  const stdinPayload = JSON.stringify({
    rootDir: context.rootDir,
    mode: context.mode,
    changedFiles: context.changedFiles ? [...context.changedFiles] : null,
  });

  const stdout = execFileSync(runner, [gatePath], {
    cwd: context.rootDir,
    input: stdinPayload,
    encoding: 'utf-8',
    timeout: 120_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return JSON.parse(stdout) as GateResult;
}

/**
 * Discover gate modules from .paw/gates/.
 * Supports any file matching a configured runner suffix (e.g. `.gate.ts`,
 * `.gate.py`, `.gate.js`). TypeScript gates are loaded via in-process
 * `import()`; all others are executed as subprocesses.
 *
 * @param gateNames - Optional filter: only load gates whose id matches
 * @returns Array of discovered QualityGate instances
 */
async function discoverGates(gateNames?: string[]): Promise<QualityGate[]> {
  const runners = loadRunnerConfig();
  let allFiles: string[];
  try {
    allFiles = readdirSync(GATES_DIR).filter(
      (f) => matchRunner(f, runners) !== null,
    );
  } catch {
    logger.warn(`No gates/ directory found at ${GATES_DIR}`);
    return [];
  }

  const files = gateNames
    ? allFiles.filter((f) => {
        const id = f.replace(/\.gate\.\w+$/, '');
        return gateNames.includes(id);
      })
    : allFiles;

  const gates: QualityGate[] = [];

  for (const file of files) {
    const suffix = matchRunner(file, runners)!;
    const runnerCmd = runners[suffix];

    try {
      if (runnerCmd === 'import') {
        const modulePath = pathToFileURL(path.join(GATES_DIR, file)).href;
        const mod = await import(modulePath);
        if (mod.gate && typeof mod.gate.check === 'function') {
          gates.push(mod.gate as QualityGate);
        } else {
          logger.warn(
            `${file} does not export a valid 'gate' constant — skipped`,
          );
        }
      } else {
        const gatePath = path.join(GATES_DIR, file);
        const id = file.replace(/\.gate\.\w+$/, '');
        gates.push({
          id,
          name: id,
          port: 'custom',
          severity: 'critical',
          appliesTo: [],
          async check(context: GateContext): Promise<GateResult> {
            return runSubprocessGate(runnerCmd, gatePath, context);
          },
        } as QualityGate);
      }
    } catch (err: unknown) {
      logger.error(`Failed to load ${file}: ${(err as Error).message}`);
    }
  }

  return gates;
}

/**
 * Topological sort of gates by dependsOn declarations.
 * Throws if a cycle is detected.
 *
 * @param gates - Gates to sort
 * @returns Sorted gates in execution order
 */
function resolveExecutionOrder(gates: QualityGate[]): QualityGate[] {
  const byId = new Map(gates.map((g) => [g.id, g]));
  const visited = new Set<string>();
  const sorted: QualityGate[] = [];
  const visiting = new Set<string>();

  function visit(gate: QualityGate): void {
    if (visited.has(gate.id)) return;
    if (visiting.has(gate.id)) {
      throw new Error(`Dependency cycle detected involving gate: ${gate.id}`);
    }
    visiting.add(gate.id);
    for (const depId of gate.dependsOn ?? []) {
      const dep = byId.get(depId);
      if (dep) visit(dep);
    }
    visiting.delete(gate.id);
    visited.add(gate.id);
    sorted.push(gate);
  }

  for (const gate of gates) visit(gate);
  return sorted;
}

/**
 * Run all discovered gates and produce a HealthReport.
 *
 * @param rootDir - Project root
 * @param mode - Execution scope
 * @param staged - Whether to scope to staged files
 * @param gateNames - Optional gate name filter
 * @param port - Optional port filter
 * @returns Aggregated HealthReport
 */
async function orchestrate(
  rootDir: string,
  mode: 'full' | 'changed-only',
  staged: boolean,
  gateNames?: string[],
  port?: GatePort,
): Promise<HealthReport> {
  const context = buildGateContext(rootDir, mode, staged);
  return orchestrateWithContext(context, gateNames, port);
}

/**
 * Run gates against a pre-built GateContext.
 * Shared implementation used by both the CLI entrypoint and the exported API.
 *
 * @param context - Pre-built gate context
 * @param gateNames - Optional gate name filter
 * @param port - Optional port filter
 * @returns Aggregated HealthReport
 */
async function orchestrateWithContext(
  context: GateContext,
  gateNames?: string[],
  port?: GatePort,
): Promise<HealthReport> {
  if (
    context.mode === 'changed-only' &&
    context.changedFiles &&
    context.changedFiles.size === 0
  ) {
    return {
      timestamp: new Date().toISOString(),
      mode: context.mode,
      changedFiles: [],
      overall: 'PASS',
      summary: {
        totalGates: 0,
        passed: 0,
        failed: 0,
        totalFindings: 0,
        hasCritical: false,
      },
      gates: [],
    };
  }

  let gates = await discoverGates(gateNames);

  if (port) {
    gates = gates.filter((g) => g.port === port);
  }

  const ordered = resolveExecutionOrder(gates);
  const results: GateResult[] = [];
  let hasCritical = false;

  for (const gate of ordered) {
    const s = logger.spin();
    s.start(gate.name);
    const start = performance.now();

    try {
      const result = await gate.check(context);
      result.stats.durationMs = Math.round(performance.now() - start);
      result.findings = await filterGateFindings(
        gate.id,
        result.findings,
        (rel) => context.readFile(rel),
      );
      result.passed = result.findings.length === 0;
      results.push(result);

      if (!result.passed && result.severity === 'critical') {
        hasCritical = true;
        s.stop(`❌ ${gate.name} — FAIL (${result.findings.length} issue(s))`);
      } else if (!result.passed) {
        s.stop(`⚠️  ${gate.name} — WARN (${result.findings.length} issue(s))`);
      } else {
        s.stop(`✅ ${gate.name} — PASS`);
      }
    } catch (err: unknown) {
      const durationMs = Math.round(performance.now() - start);
      results.push({
        gate: gate.id,
        passed: false,
        severity: 'critical',
        findings: [
          {
            file: gate.id,
            rule: 'gate-error',
            message:
              (err as Error).message?.substring(0, 300) ?? 'Unknown error',
            suggestion: 'Check gate implementation',
          },
        ],
        stats: { filesChecked: 0, findingsCount: 1, durationMs },
      });
      hasCritical = true;
      s.stop(
        `💥 ${gate.name} — ERROR: ${(err as Error).message?.substring(0, 80)}`,
      );
    }
  }

  return {
    timestamp: new Date().toISOString(),
    mode: context.mode,
    changedFiles: context.changedFiles ? [...context.changedFiles] : null,
    overall: hasCritical ? 'FAIL' : 'PASS',
    summary: {
      totalGates: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      totalFindings: results.reduce((sum, r) => sum + r.findings.length, 0),
      hasCritical,
    },
    gates: results,
  };
}

/**
 * Run all applicable gates against an explicit set of files.
 * Designed for the post-tool-use hook to get instant per-file feedback.
 *
 * @param {string} rootDir - Project root absolute path
 * @param {string[]} relativePaths - File paths relative to rootDir
 * @param {{ gateNames?: string[]; port?: GatePort }} [options] - Optional filters
 * @returns {Promise<HealthReport>} Gate results scoped to the given files
 */
export async function runGatesForFiles(
  rootDir: string,
  relativePaths: string[],
  options?: { gateNames?: string[]; port?: GatePort },
): Promise<HealthReport> {
  const context = buildSingleFileContext(rootDir, relativePaths);
  return orchestrateWithContext(context, options?.gateNames, options?.port);
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const { mode, staged, gateNames, port } = parseArgs();

  const modeLabel = staged
    ? '(staged files only)'
    : mode === 'changed-only'
      ? '(diff-scoped)'
      : '(full codebase)';

  const filterLabel = gateNames
    ? ` [gates: ${gateNames.join(', ')}]`
    : port
      ? ` [port: ${port}]`
      : '';

  logger.pawIntro(`PAW Health Check ${modeLabel}${filterLabel}`);

  const report = await orchestrate(ROOT, mode, staged, gateNames, port);

  logger.step(`Overall: ${report.overall}`);
  logger.info(
    `Gates: ${report.summary.passed}/${report.summary.totalGates} passed`,
  );
  logger.info(`Findings: ${report.summary.totalFindings}`);

  if (report.summary.hasCritical) {
    logger.error('CRITICAL issues found — completion is BLOCKED.');
    for (const gr of report.gates.filter(
      (r) => r.severity === 'critical' && !r.passed,
    )) {
      logger.error(`${gr.gate}:`);
      for (const f of gr.findings.slice(0, 10)) {
        const loc = f.line ? `:${f.line}` : '';
        logger.message(`  ${f.file}${loc} — ${f.message}`);
      }
      if (gr.findings.length > 10) {
        logger.message(`  ... and ${gr.findings.length - 10} more`);
      }
    }
  }

  /** Machine-readable JSON for hooks and CI */
  console.log('\n---JSON_REPORT_START---');
  console.log(JSON.stringify(report, null, 2));
  console.log('---JSON_REPORT_END---');

  logger.pawOutro(
    report.summary.hasCritical ? 'Health check FAILED' : 'Health check PASSED',
  );

  process.exit(report.summary.hasCritical ? 1 : 0);
}

/**
 * True when this module is the direct entry point (not imported by another module).
 * Guard is narrowed to only match when the script name contains "pawGates" or "health-check"
 * to avoid triggering the full-scan main() when bundled into hook .mjs files.
 */
const isDirectRun =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) &&
  /paw.?gates|health.?check/i.test(path.basename(process.argv[1]));

if (isDirectRun) {
  main().catch((err: Error) => {
    logger.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
}
