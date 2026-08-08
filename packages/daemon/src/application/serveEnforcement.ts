/**
 * PAW Enforcement Service
 *
 * @fileoverview The composition that makes the resident daemon serve enforcement:
 * it owns a store and a gate cache once, and exposes them over the socket as the
 * `hook.dispatch` method, which runs {@link dispatchHook} — the same loop the
 * cold hook used to run per process. A hook is now a thin client of this; the
 * store's single owner and the gate cache's single import are what this buys
 * (doc 10 §2, §8). The caller derives the socket path and token from the project
 * and creates the store/gate/connectors; this only wires and listens.
 *
 * @module @paw/daemon/application/serveEnforcement
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  PAW_EVENT_TYPES,
  RPC_PROTOCOL_VERSION,
  dispatchHook,
  type DispatchHookDeps,
  type HookDispatch,
  type PawEventType,
} from '@paw/core';
import { createRpcSession } from './rpcSession.js';
import { listenSocket, type SocketServerHandle } from '../infrastructure/socketServer.js';

const EVENTS: ReadonlySet<string> = new Set(PAW_EVENT_TYPES);

/**
 * What the enforcement service needs, all owned once by the caller.
 *
 * @interface EnforcementOptions
 * @property {string} socketPath - The endpoint to bind.
 * @property {string} token - The handshake token clients must present.
 * @property {string} projectRoot - The root pawd serves, reported at handshake.
 * @property {DispatchHookDeps} deps - The store, gates, connectors, and policy the loop runs against.
 */
export interface EnforcementOptions {
  readonly socketPath: string;
  readonly token: string;
  readonly projectRoot: string;
  readonly deps: DispatchHookDeps;
}

/**
 * Narrow untrusted RPC params into a {@link HookDispatch}, or null when they are
 * not a well-formed dispatch. An allow-list: only host, a known event, and an
 * object payload are taken.
 *
 * @param {unknown} params - The method params off the wire.
 * @returns {HookDispatch | null} The dispatch, or null.
 */
function toDispatch(params: unknown): HookDispatch | null {
  const p = (params ?? {}) as { host?: unknown; event?: unknown; payload?: unknown };
  if (typeof p.host !== 'string' || typeof p.event !== 'string' || !EVENTS.has(p.event)) {
    return null;
  }
  const payload =
    typeof p.payload === 'object' && p.payload !== null
      ? (p.payload as Record<string, unknown>)
      : {};
  return { host: p.host, event: p.event as PawEventType, payload };
}

/**
 * Serve enforcement over the socket and return the running server.
 *
 * @param {EnforcementOptions} opts - The endpoint, token, root, and owned deps.
 * @returns {Promise<SocketServerHandle>} The running server.
 */
export function serveEnforcement(opts: EnforcementOptions): Promise<SocketServerHandle> {
  const hello = {
    protocolVersion: RPC_PROTOCOL_VERSION,
    projectRoot: opts.projectRoot,
    capabilities: ['gates', 'violations'],
    health: 'ok',
  };
  const methods = {
    'hook.dispatch': async (params: unknown): Promise<unknown> => {
      const req = toDispatch(params);
      return req === null ? { continue: true } : dispatchHook(opts.deps, req);
    },
  };
  return listenSocket(opts.socketPath, () =>
    createRpcSession({
      token: opts.token,
      protocolVersion: RPC_PROTOCOL_VERSION,
      hello,
      methods,
    }),
  );
}
