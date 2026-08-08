/**
 * PAW Gate Contract
 *
 * @fileoverview The QualityGate contract, ported verbatim from the legacy
 * `healthCheckTypes.ts` so a consumer's `.paw/gates/*.gate.*` files compile and
 * run unchanged. A gate is a pure decision over a {@link GateContext}; discovery,
 * loading, and execution live behind the {@link module:@paw/core/ports.GateRunner}
 * port. These are the shapes every gate, the runner, and the detector share.
 *
 * @module @paw/core/domain/gate
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Logical grouping for quality gates. Ports enable running subsets of checks
 * (e.g. only `code-quality` gates).
 */
export type GatePort =
  | 'code-quality'
  | 'content-structure'
  | 'test-coverage'
  | 'build-integrity'
  | 'custom';

/**
 * A single quality gate. Implementations are auto-discovered from `.paw/gates/`.
 *
 * @interface QualityGate
 * @property {string} id - Unique kebab-case identifier.
 * @property {string} name - Human-readable display name.
 * @property {GatePort} port - Logical grouping.
 * @property {'critical' | 'warning'} severity - Base severity when this gate fails.
 * @property {string[]} appliesTo - File extensions this gate cares about.
 * @property {string[]} [dependsOn] - Gate IDs that must run before this one.
 */
export interface QualityGate {
  readonly id: string;
  readonly name: string;
  readonly port: GatePort;
  readonly severity: 'critical' | 'warning';
  readonly appliesTo: string[];
  readonly dependsOn?: string[];
  check(context: GateContext): Promise<GateResult>;
}

/**
 * Execution context passed to every gate. Contains pre-resolved file lists, mode
 * flags, and git state.
 *
 * @interface GateContext
 * @property {string} rootDir - Project root absolute path.
 * @property {'full' | 'changed-only'} mode - Execution scope.
 * @property {ReadonlySet<string> | null} changedFiles - Changed file paths when scoped.
 * @property {boolean} staged - Whether scoped to git staging area only.
 */
export interface GateContext {
  readonly rootDir: string;
  readonly mode: 'full' | 'changed-only';
  readonly changedFiles: ReadonlySet<string> | null;
  readonly staged: boolean;
  targetFiles(appliesTo: string[], scanDirs?: string[]): Promise<string[]>;
  readFile(relativePath: string): Promise<string>;
  git(command: string): string;
}

/**
 * A single violation found by a gate.
 *
 * @interface GateFinding
 * @property {string} file - File path relative to project root.
 * @property {number} [line] - Line number (1-based).
 * @property {string} rule - Rule identifier within this gate.
 * @property {string} message - Human-readable violation description.
 * @property {string} [suggestion] - Actionable fix suggestion.
 * @property {'critical' | 'warning'} [severity] - Per-finding severity override.
 * @property {boolean} [indirectFix] - True if this finding cannot be fixed by editing the violated file.
 */
export interface GateFinding {
  file: string;
  line?: number;
  rule: string;
  message: string;
  suggestion?: string;
  severity?: 'critical' | 'warning';
  indirectFix?: boolean;
}

/**
 * Execution statistics for a gate run.
 *
 * @interface GateStats
 * @property {number} filesChecked - Number of files examined.
 * @property {number} findingsCount - Number of findings.
 * @property {number} durationMs - Execution time in milliseconds.
 */
export interface GateStats {
  filesChecked: number;
  findingsCount: number;
  durationMs: number;
  [key: string]: number;
}

/**
 * Output from a single gate execution.
 *
 * @interface GateResult
 * @property {string} gate - Gate identifier.
 * @property {boolean} passed - True if no violations found.
 * @property {'critical' | 'warning' | 'info'} severity - Effective severity.
 * @property {GateFinding[]} findings - Individual violations.
 * @property {GateStats} stats - Execution statistics.
 */
export interface GateResult {
  gate: string;
  passed: boolean;
  severity: 'critical' | 'warning' | 'info';
  findings: GateFinding[];
  stats: GateStats;
}

/**
 * Top-level report produced by the gate runner.
 *
 * @interface HealthReport
 * @property {string} timestamp - ISO timestamp of the run.
 * @property {'full' | 'changed-only'} mode - Execution mode.
 * @property {string[] | null} changedFiles - Changed file list when scoped.
 * @property {'PASS' | 'FAIL'} overall - Aggregate result.
 * @property {object} summary - Aggregate counters.
 * @property {GateResult[]} gates - Per-gate results.
 */
export interface HealthReport {
  timestamp: string;
  mode: 'full' | 'changed-only';
  changedFiles: string[] | null;
  overall: 'PASS' | 'FAIL';
  summary: {
    totalGates: number;
    passed: number;
    failed: number;
    totalFindings: number;
    hasCritical: boolean;
  };
  gates: GateResult[];
}
