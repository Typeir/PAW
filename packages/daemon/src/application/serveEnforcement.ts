/**
 * PAW Enforcement Service
 *
 * @fileoverview The composition that makes the resident daemon serve enforcement,
 * and the order that keeps a single daemon honest: it CLAIMS the endpoint first
 * (the OS lets exactly one process bind it), and only then runs `configure` to
 * open the store and write the token. A daemon that loses the race never reaches
 * `configure`, so it never clobbers the winner's token or store — no reliance on
 * a removable lockfile for that guarantee. Once claimed, the store and warm gate
 * cache it owns are exposed as `hook.dispatch`, which runs {@link dispatchHook}
 * (doc 10 §2, §8). A losing bind releases nothing because it wrote nothing.
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
import {
  bindSocket,
  serveSessions,
  type SocketServerHandle,
} from '../infrastructure/socketServer.js';

const EVENTS: ReadonlySet<string> = new Set(PAW_EVENT_TYPES);

/**
 * What `configure` yields once the endpoint is claimed.
 *
 * @interface EnforcementConfig
 * @property {string} token - The handshake token clients must present.
 * @property {DispatchHookDeps} deps - The store, gates, connectors, and policy the loop runs against.
 */
export interface EnforcementConfig {
  readonly token: string;
  readonly deps: DispatchHookDeps;
}

/**
 * What the enforcement service needs.
 *
 * @interface EnforcementOptions
 * @property {string} socketPath - The endpoint to claim.
 * @property {string} projectRoot - The root pawd serves, reported at handshake.
 * @property {() => Promise<EnforcementConfig>} configure - Produces the token and deps, run ONLY after the claim — the place any writes to `.paw` belong.
 * @property {{ ms: number; onIdle: () => void }} [idle] - Close and signal after this many ms with no hook call; omit to stay resident. Doc 10 §9c — industrial is not leaking a process per repo forever.
 */
export interface EnforcementOptions {
  readonly socketPath: string;
  readonly projectRoot: string;
  configure(): Promise<EnforcementConfig>;
  readonly idle?: { ms: number; onIdle: () => void };
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
 * Claim the endpoint and serve enforcement, returning the running server.
 *
 * @param {EnforcementOptions} opts - The endpoint, root, and post-claim configure.
 * @returns {Promise<SocketServerHandle>} The running server; rejects when a live daemon already holds the endpoint (having written nothing).
 */
export async function serveEnforcement(opts: EnforcementOptions): Promise<SocketServerHandle> {
  const server = await bindSocket(opts.socketPath);
  const idle = opts.idle;
  let handle: SocketServerHandle;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = (): void => {
    if (!idle) {
      return;
    }
    const onIdle = idle.onIdle;
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      void handle.close().then(onIdle);
    }, idle.ms);
    idleTimer.unref();
  };

  try {
    const { token, deps } = await opts.configure();
    const hello = {
      protocolVersion: RPC_PROTOCOL_VERSION,
      projectRoot: opts.projectRoot,
      capabilities: ['gates', 'violations'],
      health: 'ok',
    };
    const methods = {
      'hook.dispatch': async (params: unknown): Promise<unknown> => {
        resetIdle();
        const req = toDispatch(params);
        return req === null ? { continue: true } : dispatchHook(deps, req);
      },
    };
    handle = serveSessions(server, () =>
      createRpcSession({ token, protocolVersion: RPC_PROTOCOL_VERSION, hello, methods }),
    );
    resetIdle();
    return handle;
  } catch (err: unknown) {
    await new Promise<void>((done) => server.close(() => done()));
    throw err;
  }
}
