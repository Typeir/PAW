/**
 * PAW Hook Dispatch
 *
 * @fileoverview Per-hook handler resident daemon run. Take host, canonical event,
 * raw payload: pick host connector, translate payload to canonical event, run it
 * through {@link handleEvent} against daemon owned store and gate cache, translate
 * response back to host native output. Daemon own deps; this compose over them.
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
 * Hook invocation to dispatch.
 *
 * @interface HookDispatch
 * @property {string} host - Host key (e.g. `copilot`), pick connector.
 * @property {PawEventType} event - Canonical event command name.
 * @property {Record<string, unknown>} payload - Host raw hook payload.
 */
export interface HookDispatch {
  readonly host: string;
  readonly event: PawEventType;
  readonly payload: Record<string, unknown>;
}

/**
 * Dispatch deps: loop deps daemon own, plus connector registry.
 *
 * @interface DispatchHookDeps
 * @property {Record<string, HostConnector>} connectors - Host key → connector.
 */
export interface DispatchHookDeps extends HandleDeps {
  readonly connectors: Record<string, HostConnector>;
}

/**
 * Handle one hook invocation, return host native output object.
 *
 * @param {DispatchHookDeps} deps - Owned deps and connector registry.
 * @param {HookDispatch} req - Host, event, payload.
 * @returns {Promise<unknown>} Host output; bare `{ continue: true }` when host
 * unknown or payload no resolve to event.
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
