/**
 * PAW Enforcement Decision
 *
 * @fileoverview The pre-tool-use enforcement decision. Given the outstanding
 * violations for a session and the tool a caller is about to run, decide whether
 * to allow or deny it. Legacy `preToolUse.ts` hook do this rule inline against SQLite
 * and payload parsing; here pure function over already-resolved data, delegate
 * violation-set operations to {@link module:@paw/core/domain/violation}. Pulling file
 * paths from tool payload, smelling `.env` access, querying unresolved violations,
 * and testing paths against `.pawignore` belong to adapters. Domain get resolved
 * inputs and hold rule.
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
 * Outcome of enforcement decision. `allow` may carry `additionalContext` —
 * hidden guidance dropped in for model (the indirect-fix nudge). `deny` always
 * carry reason shown to agent.
 */
export type Decision =
  | { readonly kind: 'allow'; readonly additionalContext?: string }
  | { readonly kind: 'deny'; readonly reason: string };

/**
 * Everything decision need, all pre-resolved by adapters.
 *
 * @interface PreToolInput
 * @property {string} toolName - Tool about to run.
 * @property {readonly string[]} targetPaths - Project-relative paths tool would touch (may be empty).
 * @property {string | null} envMatch - Detected secret/`.env` path or command snippet, or null when clean.
 * @property {ReadonlySet<string>} exemptTools - Read-only tools never blocked by violations.
 * @property {ReadonlySet<string>} ignoredPaths - The subset of targetPaths that `.pawignore` cover.
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
 * Decide whether tool may run, given outstanding violations.
 *
 * @param {PreToolInput} i - The pre-resolved decision input.
 * @returns {Decision} The allow/deny decision.
 *
 * @description
 * Order mirror legacy hook:
 * 1. Secrets first: tool touching `.env` denied even when read-only;
 *    credentials must never enter model context.
 * 2. Exempt (read-only) tools otherwise always allowed.
 * 3. No unresolved violations → allow.
 * 4. Every targeted path pawignored → allow.
 * 5. Fix path: touching file with direct violation always allowed.
 * 6. Only indirect-fix violations remain → allow with nudge (fix need new file).
 * 7. Otherwise direct violation exist elsewhere → deny, name files.
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
