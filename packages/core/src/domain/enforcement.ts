/**
 * PAW Enforcement Decision
 *
 * @fileoverview The pre-tool-use enforcement decision — the pure heart of PAW.
 * Given the outstanding violations for a session and the tool a caller is about
 * to run, decide whether to allow or deny it. This is the domain rule the legacy
 * `preToolUse.ts` hook implemented inline against SQLite and a tangle of payload
 * parsing; here it is a pure function over already-resolved data, delegating the
 * violation-set operations to {@link module:@paw/core/domain/violation}. The
 * messy work — extracting file paths from a tool payload, detecting `.env`
 * access, querying unresolved violations, testing paths against `.pawignore` —
 * belongs to adapters. The domain receives clean inputs and holds only the rule.
 *
 * @module @paw/core/domain/enforcement
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  allIndirect,
  directlyViolatedFiles,
  formatIndirectNudge,
  formatOutstanding,
  type Violation,
} from './violation.js';

/**
 * The outcome of an enforcement decision. `allow` may carry `additionalContext`
 * — hidden guidance injected for the model (the indirect-fix nudge). `deny`
 * always carries a reason shown to the agent.
 */
export type Decision =
  | { readonly kind: 'allow'; readonly additionalContext?: string }
  | { readonly kind: 'deny'; readonly reason: string };

/**
 * Everything the decision needs, all pre-resolved by adapters.
 *
 * @interface PreToolInput
 * @property {string} toolName - The tool about to run.
 * @property {readonly string[]} targetPaths - Project-relative paths the tool would touch (may be empty).
 * @property {string | null} envMatch - A detected secret/`.env` path or command snippet, or null when clean.
 * @property {ReadonlySet<string>} exemptTools - Read-only tools never blocked by violations.
 * @property {ReadonlySet<string>} ignoredPaths - The subset of targetPaths that `.pawignore` covers.
 * @property {readonly Violation[]} violations - Unresolved violations in scope for this session.
 */
export interface PreToolInput {
  readonly toolName: string;
  readonly targetPaths: readonly string[];
  readonly envMatch: string | null;
  readonly exemptTools: ReadonlySet<string>;
  readonly ignoredPaths: ReadonlySet<string>;
  readonly violations: readonly Violation[];
}

/**
 * Decide whether a tool may run, given outstanding violations.
 *
 * @param {PreToolInput} i - The pre-resolved decision input.
 * @returns {Decision} The allow/deny decision.
 *
 * @description
 * The order is load-bearing and mirrors the legacy hook exactly:
 * 1. Secrets first — a tool touching `.env` is denied even if it is read-only,
 *    because credentials must never enter the model context.
 * 2. Exempt (read-only) tools are otherwise always allowed.
 * 3. No unresolved violations → allow.
 * 4. Every targeted path is pawignored → allow.
 * 5. The fix path — touching a file with a direct violation is always allowed.
 * 6. Only indirect-fix violations remain → allow with a nudge (the fix needs a
 *    new file, so blocking would deadlock).
 * 7. Otherwise a direct violation exists elsewhere → deny, naming the files.
 */
export function decidePreToolUse(i: PreToolInput): Decision {
  if (i.envMatch !== null) {
    return {
      kind: 'deny',
      reason:
        `Access to ${i.envMatch} is blocked: environment files must never ` +
        `enter the model context.`,
    };
  }

  if (i.exemptTools.has(i.toolName)) {
    return { kind: 'allow' };
  }

  if (i.violations.length === 0) {
    return { kind: 'allow' };
  }

  if (
    i.targetPaths.length > 0 &&
    i.targetPaths.every((p) => i.ignoredPaths.has(p))
  ) {
    return { kind: 'allow' };
  }

  const directlyViolated = directlyViolatedFiles(i.violations);
  if (i.targetPaths.some((p) => directlyViolated.has(p))) {
    return { kind: 'allow' };
  }

  if (allIndirect(i.violations)) {
    return { kind: 'allow', additionalContext: formatIndirectNudge(i.violations) };
  }

  return {
    kind: 'deny',
    reason: formatOutstanding(i.violations.filter((v) => !v.indirectFix)),
  };
}
