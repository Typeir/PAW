/**
 * PAW enforcement service.
 *
 * @fileoverview Composition make resident daemon serve enforcement. Order: it
 * CLAIM endpoint first (OS let exactly one process bind it), then run
 * `configure` to open store and write token. Daemon lose race
 * never reach `configure`, so never clobber winner token or store — no rely on
 * removable lockfile for that guarantee. Once claimed, store and warm gate cache
 * it own expose as `hook.dispatch`, which run {@link dispatchHook}
 * (doc 10 §2, §8). Losing bind release nothing because write nothing.
 *
 * @module @paw/daemon/application/serveEnforcement
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { RPC_PROTOCOL_VERSION, type DispatchHookDeps } from '@paw/core';
import { enforcementMethods } from './enforcementMethods.js';
import { createRpcSession } from './rpcSession.js';
import {
  bindSocket,
  serveSessions,
  type SocketServerHandle,
} from '../infrastructure/socketServer.js';

/**
 * What `configure` yield once endpoint claimed.
 *
 * @interface EnforcementConfig
 * @property {string} token - Handshake token client must present.
 * @property {DispatchHookDeps} deps - Store, gates, connectors, policy loop run against.
 */
export interface EnforcementConfig {
  readonly token: string;
  readonly deps: DispatchHookDeps;
}

/**
 * What enforcement service need.
 *
 * @interface EnforcementOptions
 * @property {string} socketPath - Endpoint to claim.
 * @property {string} projectRoot - Root pawd serve, report at handshake.
 * @property {() => Promise<EnforcementConfig>} configure - Produce token and deps, run ONLY after claim — place any write to `.paw` belong.
 * @property {{ ms: number; onIdle: () => void }} [idle] - Close and signal after this many ms with no hook call; omit to stay resident. Doc 10 §9c — prevents one leaked process lingering per repo.
 * @property {{ pid: number; now: () => number; onStop: () => void }} [control] - Enable `daemon.status`/`daemon.stop`; pid and clock they report, shutdown they trigger. Doc 10 §12.
 */
export interface EnforcementOptions {
  readonly socketPath: string;
  readonly projectRoot: string;
  configure(): Promise<EnforcementConfig>;
  readonly idle?: { ms: number; onIdle: () => void };
  readonly control?: { pid: number; now: () => number; onStop: () => void };
}

/**
 * Claim endpoint and serve enforcement, return running server.
 *
 * @param {EnforcementOptions} opts - Endpoint, root, post-claim configure.
 * @returns {Promise<SocketServerHandle>} Running server; reject when live daemon already hold endpoint (wrote nothing).
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
    const methods = enforcementMethods(deps, {
      projectRoot: opts.projectRoot,
      resetIdle,
      control: opts.control,
      close: () => handle.close(),
    });
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
