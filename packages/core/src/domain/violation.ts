/**
 * PAW violation domain.
 *
 * @fileoverview `Violation` type and pure operations over set of them. Nothing here do I/O; persistence is {@link StorePort}'s job.
 *
 * @module @paw/core/domain/violation
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Unresolved rule violation reported for a single file.
 *
 * @interface Violation
 * @property {number} id - Stable id from store.
 * @property {string} filePath - Project-relative, forward-slash path adapter normalise.
 * @property {string} rule - Gate or hook rule raise it.
 * @property {string} message - Human-readable description show to agent.
 * @property {boolean} indirectFix - True when fix need different file (e.g. missing test); edit flagged file no clear it.
 */
export interface Violation {
  readonly id: number;
  readonly filePath: string;
  readonly rule: string;
  readonly message: string;
  readonly indirectFix: boolean;
}

/**
 * Set of files carry at least one direct (non-indirect) violation. Fix path must always allow edit them.
 *
 * @param {readonly Violation[]} violations - Unresolved violations in scope.
 * @returns {ReadonlySet<string>} File paths with direct violation.
 */
export function directlyViolatedFiles(
  violations: readonly Violation[],
): ReadonlySet<string> {
  return new Set(
    violations.filter((v) => !v.indirectFix).map((v) => v.filePath),
  );
}

/**
 * Every violation indirect-fix? True = nudge agent; false = block.
 *
 * @param {readonly Violation[]} violations - Unresolved violations in scope.
 * @returns {boolean} True if all are indirect-fix.
 */
export function allIndirect(violations: readonly Violation[]): boolean {
  return violations.every((v) => v.indirectFix);
}

/**
 * Most items any enforcement reason list before summarise rest, and hard character ceiling on whole reason. Both caps keep every reason small enough display inline.
 */
const MAX_ITEMS = 15;
const MAX_REASON = 4000;

/**
 * Cap reason length fit inline display.
 *
 * @param {string} text - The reason.
 * @param {number} [max] - Character ceiling; default {@link MAX_REASON}.
 * @returns {string} Reason, truncated with marker when exceed ceiling.
 */
export function truncate(text: string, max: number = MAX_REASON): string {
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;
}

/**
 * Hidden nudge shown when only indirect-fix violations remain, capped to stay displayable.
 *
 * @param {readonly Violation[]} violations - Indirect-fix violations.
 * @returns {string} Bounded nudge list files and messages.
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
 * Deny reason: each directly-violated file with rules failing on it. Bounded to stay displayable.
 *
 * @param {readonly Violation[]} violations - Directly-violated (non-indirect) violations.
 * @returns {string} Bounded deny reason, one line per file.
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
