/**
 * PAW Event Router
 *
 * @fileoverview Input boundary of PAW loop. Connector hand canonical
 * {@link PawEvent} here; route to right use-case, return canonical
 * {@link PawResponse}. Host-agnostic: same routing run whether event come from
 * Copilot CLI, SDK, VS Code, or future host. Only `tool.pre` (enforcement) and
 * `prompt.submitted` (L1 context) act today; rest return `noop`.
 *
 * @module @paw/core/application/handleEvent
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { Decision } from '../domain/enforcement.js';
import type { PawEvent, PawResponse } from '../domain/event.js';
import type { GateRunner, LinterRunner, StorePort } from '../ports/index.js';
import { checkEdit } from './checkEdit.js';
import { checkTool, type CheckToolRequest } from './checkTool.js';

/**
 * Router dependencies for serving events.
 *
 * @interface HandleDeps
 * @property {StorePort} store - Violation store, for enforcement decision.
 * @property {ReadonlySet<string>} exemptTools - Read-only tools no violate ever block.
 * @property {(path: string) => boolean} isIgnored - Say if path pawignored.
 * @property {GateRunner} [gates] - Run gates on edited files for `tool.post`; omit to skip detection.
 * @property {LinterRunner} [linters] - Run enabled linter connectors on edited files for `tool.post`; findings deferred. Omit to run no linters.
 * @property {(sessionId: string | null) => Promise<string>} [loadL1] - Make L1 context block for prompt; omit to inject nothing.
 * @property {(path: string) => string} [toRelative] - Normalise host path (maybe absolute) to project-relative; omit to leave paths as given.
 */
export interface HandleDeps {
  readonly store: StorePort;
  readonly exemptTools: ReadonlySet<string>;
  readonly isIgnored: (path: string) => boolean;
  readonly gates?: GateRunner;
  readonly linters?: LinterRunner;
  readonly loadL1?: (sessionId: string | null) => Promise<string>;
  readonly toRelative?: (path: string) => string;
}

/**
 * Map enforcement {@link Decision} to canonical {@link PawResponse}.
 *
 * @param {Decision} d - The decision.
 * @returns {PawResponse} The canonical response.
 */
function decisionToResponse(d: Decision): PawResponse {
  if (d.kind === 'deny') {
    return { kind: 'deny', reason: d.reason };
  }
  return d.additionalContext !== undefined
    ? { kind: 'allow', additionalContext: d.additionalContext }
    : { kind: 'allow' };
}

/**
 * Route canonical event to use-case, return canonical response.
 *
 * @param {PawEvent} event - Canonical event from connector.
 * @param {HandleDeps} deps - Router dependencies.
 * @returns {Promise<PawResponse>} Canonical response for connector to translate.
 */
export async function handleEvent(
  event: PawEvent,
  deps: HandleDeps,
): Promise<PawResponse> {
  const rel = deps.toRelative ?? ((p: string) => p);
  switch (event.type) {
    case 'tool.pre': {
      const targetPaths = event.targetPaths.map(rel);
      const ignoredPaths = new Set(targetPaths.filter((p) => deps.isIgnored(p)));
      const req: CheckToolRequest = {
        sessionId: event.sessionId,
        toolName: event.toolName,
        targetPaths,
        envMatch: event.envMatch,
        exemptTools: deps.exemptTools,
        ignoredPaths,
      };
      return decisionToResponse(await checkTool(deps.store, req));
    }
    case 'tool.post': {
      if (!deps.gates) {
        return { kind: 'noop' };
      }
      return checkEdit(
        {
          store: deps.store,
          gates: deps.gates,
          isIgnored: deps.isIgnored,
          ...(deps.linters === undefined ? {} : { linters: deps.linters }),
        },
        { ...event, editedPaths: event.editedPaths.map(rel) },
      );
    }
    case 'prompt.submitted': {
      if (!deps.loadL1) {
        return { kind: 'noop' };
      }
      const context = await deps.loadL1(event.sessionId);
      return context.length > 0
        ? { kind: 'context', additionalContext: context }
        : { kind: 'noop' };
    }
    default:
      return { kind: 'noop' };
  }
}
