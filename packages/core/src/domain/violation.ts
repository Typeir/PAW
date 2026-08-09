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
 * The most items any enforcement reason lists before summarising the rest, and
 * the hard character ceiling on the whole reason. A hook output too large to
 * display inline is enforcement the agent is blind to — the feedback is
 * redirected to a file it never reads, so it cannot self-correct. Both caps keep
 * every reason small enough to reach the agent.
 */
const MAX_ITEMS = 15;
const MAX_REASON = 4000;

/**
 * Cap a reason's length so it always fits an inline display.
 *
 * @param {string} text - The reason.
 * @param {number} [max] - The character ceiling; defaults to {@link MAX_REASON}.
 * @returns {string} The reason, truncated with a marker when it exceeds the ceiling.
 */
export function truncate(text: string, max: number = MAX_REASON): string {
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;
}

/**
 * The hidden nudge shown when only indirect-fix violations remain, capped so it
 * stays displayable.
 *
 * @param {readonly Violation[]} violations - The indirect-fix violations.
 * @returns {string} A bounded nudge listing files and messages.
 */
export function formatIndirectNudge(violations: readonly Violation[]): string {
  const shown = violations
    .slice(0, MAX_ITEMS)
    .map((v) => `- ${v.filePath}: ${v.message}`);
  if (violations.length > MAX_ITEMS) {
    shown.push(`- …and ${violations.length - MAX_ITEMS} more`);
  }
  return truncate(`Indirect fix required before continuing:\n${shown.join('\n')}`);
}

/**
 * The deny reason: each directly-violated file with the rules failing on it, so
 * the agent knows which file to open and what to fix — not merely that something
 * is wrong somewhere. Bounded so it stays displayable.
 *
 * @param {readonly Violation[]} violations - The directly-violated (non-indirect) violations.
 * @returns {string} A bounded deny reason, one line per file.
 */
export function formatOutstanding(violations: readonly Violation[]): string {
  const byFile = new Map<string, Set<string>>();
  for (const v of violations) {
    const rules = byFile.get(v.filePath) ?? new Set<string>();
    rules.add(v.rule);
    byFile.set(v.filePath, rules);
  }
  const files = [...byFile.entries()];
  const shown = files
    .slice(0, MAX_ITEMS)
    .map(([file, rules]) => `- ${file} (${[...rules].join(', ')})`);
  if (files.length > MAX_ITEMS) {
    shown.push(`- …and ${files.length - MAX_ITEMS} more file(s)`);
  }
  return truncate(`Fix outstanding violations before using other tools:\n${shown.join('\n')}`);
}
