/**
 * PAW Violation Domain
 *
 * @fileoverview The `Violation` domain type and the pure operations over a set
 * of them. Extracting these out of the enforcement decision keeps that decision
 * readable and gives each rule a named, individually-tested home — the "extract
 * to a helper with JSDoc rather than an inline comment" rule made structural.
 * Nothing here performs I/O; persistence is the {@link StorePort}'s job.
 *
 * @module @paw/core/domain/violation
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * An unresolved rule violation attached to a file.
 *
 * @interface Violation
 * @property {number} id - Stable identifier from the store.
 * @property {string} filePath - Project-relative, forward-slash path the adapter normalised.
 * @property {string} rule - Gate or hook rule that raised it.
 * @property {string} message - Human-readable description shown to the agent.
 * @property {boolean} indirectFix - True when the fix requires a different file (e.g. a missing test), so editing the flagged file cannot clear it.
 */
export interface Violation {
  readonly id: number;
  readonly filePath: string;
  readonly rule: string;
  readonly message: string;
  readonly indirectFix: boolean;
}

/**
 * The set of files carrying at least one direct (non-indirect) violation. These
 * are the files whose editing the fix path must always permit.
 *
 * @param {readonly Violation[]} violations - Unresolved violations in scope.
 * @returns {ReadonlySet<string>} File paths with a direct violation.
 */
export function directlyViolatedFiles(
  violations: readonly Violation[],
): ReadonlySet<string> {
  return new Set(
    violations.filter((v) => !v.indirectFix).map((v) => v.filePath),
  );
}

/**
 * Whether every violation is indirect-fix. When true the agent must be nudged
 * rather than blocked, because the fix needs a new file that a block would
 * forbid it from creating.
 *
 * @param {readonly Violation[]} violations - Unresolved violations in scope.
 * @returns {boolean} True if all are indirect-fix.
 */
export function allIndirect(violations: readonly Violation[]): boolean {
  return violations.every((v) => v.indirectFix);
}

/**
 * The hidden nudge shown when only indirect-fix violations remain.
 *
 * @param {readonly Violation[]} violations - The indirect-fix violations.
 * @returns {string} A multi-line nudge listing each file and message.
 */
export function formatIndirectNudge(violations: readonly Violation[]): string {
  const lines = violations
    .map((v) => `- ${v.filePath}: ${v.message}`)
    .join('\n');
  return `Indirect fix required before continuing:\n${lines}`;
}

/**
 * The deny reason listing the directly-violated files that must be fixed first.
 *
 * @param {readonly string[]} files - Directly-violated file paths.
 * @returns {string} A multi-line deny reason.
 */
export function formatOutstanding(files: readonly string[]): string {
  const detail = files.map((f) => `- ${f}`).join('\n');
  return `Fix outstanding violations before using other tools:\n${detail}`;
}
