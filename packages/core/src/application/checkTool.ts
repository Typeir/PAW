/**
 * PAW Check-Tool Use-Case
 *
 * @fileoverview Join {@link StorePort} with pure enforcement decision. Fetch
 * unresolved violations for session, hand to `decidePreToolUse`, return verdict.
 * Hold only sequencing. Rule live in domain, I/O behind port. Hook client or
 * daemon call it.
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
 * A request to check whether tool run — all decision need except violations.
 * Use-case fetch violations itself.
 *
 * @interface CheckToolRequest
 * @property {string | null} sessionId - Session whose violations apply.
 * @property {string} toolName - Tool about to run.
 * @property {readonly string[]} targetPaths - Project-relative paths tool would touch.
 * @property {string | null} envMatch - Detect secret/`.env` path, or null when clean.
 * @property {ReadonlySet<string>} exemptTools - Read-only tools never blocked by violations.
 * @property {ReadonlySet<string>} ignoredPaths - Subset of targetPaths that `.pawignore` cover.
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
 * Decide whether tool run. Fetch session violations first.
 *
 * @param {StorePort} store - Store to query for unresolved violations.
 * @param {CheckToolRequest} req - Request.
 * @returns {Promise<Decision>} Allow/deny decision.
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
