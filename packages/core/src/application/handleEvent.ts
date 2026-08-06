/**
 * PAW Event Router
 *
 * @fileoverview The input boundary of PAW's loop. A connector hands a canonical
 * {@link PawEvent} here; this routes it to the right use-case and returns a
 * canonical {@link PawResponse}. The loop is host-agnostic: the same routing runs
 * whether the event came from the Copilot CLI, the SDK, VS Code, or a future
 * host. Only `tool.pre` (enforcement) and `prompt.submitted` (L1 context) act
 * today; the rest return `noop`, ready to grow without the connectors changing.
 *
 * @module @paw/core/application/handleEvent
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { Decision } from '../domain/enforcement.js';
import type { PawEvent, PawResponse } from '../domain/event.js';
import type { StorePort } from '../ports/index.js';
import { checkTool, type CheckToolRequest } from './checkTool.js';

/**
 * What the router needs to serve events.
 *
 * @interface HandleDeps
 * @property {StorePort} store - The violation store, for the enforcement decision.
 * @property {ReadonlySet<string>} exemptTools - Read-only tools never blocked by violations.
 * @property {(path: string) => boolean} isIgnored - Whether a path is pawignored.
 * @property {(sessionId: string | null) => Promise<string>} [loadL1] - Produces the L1 context block for a prompt; omit to inject nothing.
 */
export interface HandleDeps {
  readonly store: StorePort;
  readonly exemptTools: ReadonlySet<string>;
  readonly isIgnored: (path: string) => boolean;
  readonly loadL1?: (sessionId: string | null) => Promise<string>;
}

/**
 * Map an enforcement {@link Decision} to a canonical {@link PawResponse}.
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
 * Route a canonical event to its use-case and return a canonical response.
 *
 * @param {PawEvent} event - The canonical event from a connector.
 * @param {HandleDeps} deps - The router dependencies.
 * @returns {Promise<PawResponse>} The canonical response for the connector to translate.
 */
export async function handleEvent(
  event: PawEvent,
  deps: HandleDeps,
): Promise<PawResponse> {
  switch (event.type) {
    case 'tool.pre': {
      const ignoredPaths = new Set(
        event.targetPaths.filter((p) => deps.isIgnored(p)),
      );
      const req: CheckToolRequest = {
        sessionId: event.sessionId,
        toolName: event.toolName,
        targetPaths: event.targetPaths,
        envMatch: event.envMatch,
        exemptTools: deps.exemptTools,
        ignoredPaths,
      };
      return decisionToResponse(await checkTool(deps.store, req));
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
