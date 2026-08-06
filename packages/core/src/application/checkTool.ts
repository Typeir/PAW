/**
 * PAW Check-Tool Use-Case
 *
 * @fileoverview Composes the {@link StorePort} with the pure enforcement
 * decision: query the unresolved violations for a session, hand them to
 * `decidePreToolUse`, and return the verdict. The application layer holds only
 * sequencing — the rule lives in the domain, the I/O behind the port. This is
 * what a hook client (or the daemon) calls; it is tested with a fake store, so
 * no database is touched.
 *
 * @module @paw/core/application/checkTool
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  decidePreToolUse,
  type Decision,
  type PreToolInput,
} from '../domain/enforcement.js';
import type { StorePort } from '../ports/index.js';

/**
 * A request to check whether a tool may run — everything the decision needs
 * except the violations, which the use-case fetches.
 *
 * @interface CheckToolRequest
 * @property {string | null} sessionId - The session whose violations apply.
 * @property {string} toolName - The tool about to run.
 * @property {readonly string[]} targetPaths - Project-relative paths the tool would touch.
 * @property {string | null} envMatch - A detected secret/`.env` path, or null when clean.
 * @property {ReadonlySet<string>} exemptTools - Read-only tools never blocked by violations.
 * @property {ReadonlySet<string>} ignoredPaths - The subset of targetPaths that `.pawignore` covers.
 */
export interface CheckToolRequest {
  readonly sessionId: string | null;
  readonly toolName: string;
  readonly targetPaths: readonly string[];
  readonly envMatch: string | null;
  readonly exemptTools: ReadonlySet<string>;
  readonly ignoredPaths: ReadonlySet<string>;
}

/**
 * Decide whether a tool may run, fetching the session's violations first.
 *
 * @param {StorePort} store - The store to query for unresolved violations.
 * @param {CheckToolRequest} req - The request.
 * @returns {Promise<Decision>} The allow/deny decision.
 */
export async function checkTool(
  store: StorePort,
  req: CheckToolRequest,
): Promise<Decision> {
  const violations = await store.unresolvedFor(req.sessionId);
  const input: PreToolInput = {
    toolName: req.toolName,
    targetPaths: req.targetPaths,
    envMatch: req.envMatch,
    exemptTools: req.exemptTools,
    ignoredPaths: req.ignoredPaths,
    violations,
  };
  return decidePreToolUse(input);
}
