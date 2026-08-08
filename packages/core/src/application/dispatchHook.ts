/**
 * PAW Hook Dispatch
 *
 * @fileoverview The per-hook handler the resident daemon runs — the domain that
 * doc 10 §11 moves out of the cold hook process and into `pawd`, "moved, not
 * rewritten". Given the host, the canonical event, and the raw payload, it picks
 * the host connector, translates the payload to a canonical event, runs it
 * through {@link handleEvent} against the daemon's owned store and gate cache,
 * and translates the response back to the host's native output. The daemon owns
 * the dependencies once; this is the pure composition over them.
 *
 * @module @paw/core/application/dispatchHook
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { PawEventType } from '../domain/event.js';
import type { HostConnector } from '../ports/index.js';
import { handleEvent, type HandleDeps } from './handleEvent.js';

/**
 * A hook invocation to dispatch.
 *
 * @interface HookDispatch
 * @property {string} host - The host key (e.g. `copilot`), selecting a connector.
 * @property {PawEventType} event - The canonical event the command named.
 * @property {Record<string, unknown>} payload - The host's raw hook payload.
 */
export interface HookDispatch {
  readonly host: string;
  readonly event: PawEventType;
  readonly payload: Record<string, unknown>;
}

/**
 * Everything the dispatch needs: the loop dependencies the daemon owns, plus the
 * connector registry.
 *
 * @interface DispatchHookDeps
 * @property {Record<string, HostConnector>} connectors - Host key → connector.
 */
export interface DispatchHookDeps extends HandleDeps {
  readonly connectors: Record<string, HostConnector>;
}

/**
 * Handle one hook invocation and return the host's native output object.
 *
 * @param {DispatchHookDeps} deps - The owned dependencies and connector registry.
 * @param {HookDispatch} req - The host, event, and payload.
 * @returns {Promise<unknown>} The host's output; a bare `{ continue: true }` when
 * the host is unknown or the payload does not resolve to an event.
 */
export async function dispatchHook(
  deps: DispatchHookDeps,
  req: HookDispatch,
): Promise<unknown> {
  const connector = deps.connectors[req.host];
  if (!connector) {
    return { continue: true };
  }
  const hookEventName = connector.eventName(req.event) ?? undefined;
  const pawEvent = connector.toEvent({ ...req.payload, hookEventName });
  if (pawEvent === null) {
    return { continue: true };
  }
  return connector.fromResponse(await handleEvent(pawEvent, deps));
}
