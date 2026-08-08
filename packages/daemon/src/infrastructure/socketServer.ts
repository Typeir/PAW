/**
 * PAW Daemon Socket Server
 *
 * @fileoverview The `node:net` transport under the RPC session (doc 10 §4), and
 * the claim that guarantees a single resident daemon. Binding the endpoint IS the
 * claim: two processes cannot both hold one pipe/socket, so the OS — not a
 * removable lockfile — is what enforces one daemon. {@link bindSocket} binds
 * first and, on an in-use endpoint, PROBES before doing anything: a live daemon
 * means abort (never disturb it), only a stale POSIX socket with nothing behind
 * it is reaped and rebound (doc 10 §9b). Wiring the session and any writes to
 * `.paw` happen only after the claim succeeds, so a losing daemon touches nothing.
 *
 * @module @paw/daemon/infrastructure/socketServer
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { unlinkSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import type { RpcSession } from '../application/rpcSession.js';

/**
 * A running socket server.
 *
 * @interface SocketServerHandle
 * @property {() => Promise<void>} close - Stop accepting and release the endpoint.
 */
export interface SocketServerHandle {
  close(): Promise<void>;
}

/**
 * The minimal socket surface {@link attachSession} drives.
 *
 * @interface ConnSocket
 * @property {(encoding: 'utf8') => void} setEncoding - Decode incoming chunks as text.
 * @property {(event: 'data' | 'error', listener: (arg: never) => void) => void} on - Subscribe to a socket event.
 * @property {(data: string) => void} write - Send a line.
 * @property {() => void} end - Half-close after flushing.
 */
export interface ConnSocket {
  setEncoding(encoding: 'utf8'): void;
  on(event: 'data', listener: (chunk: string) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  write(data: string): void;
  end(): void;
}

/**
 * Injectable seams for {@link bindSocket}, so its claim logic tests without a real
 * pipe.
 *
 * @interface BindSeams
 * @property {(path: string) => Promise<Server>} [listen] - Bind a bare server, rejecting if in use.
 * @property {(path: string) => Promise<boolean>} [probe] - Whether a live server answers the endpoint.
 */
export interface BindSeams {
  listen?(path: string): Promise<Server>;
  probe?(path: string): Promise<boolean>;
}

/**
 * Remove a socket path, tolerating its absence — the reap for a stale POSIX
 * socket a crashed daemon left behind.
 *
 * @param {string} path - The socket path to remove.
 */
export function reapSocket(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* already gone */
  }
}

/**
 * Wire one connection to a session: chunks in, framed lines out, closed on the
 * session's say-so. Pushes are serialised so the session sees chunks in order.
 *
 * @param {ConnSocket} socket - The connection.
 * @param {RpcSession} session - Its fresh session.
 */
export function attachSession(socket: ConnSocket, session: RpcSession): void {
  socket.setEncoding('utf8');
  let chain: Promise<void> = Promise.resolve();
  socket.on('data', (chunk: string) => {
    chain = chain.then(async () => {
      const { lines, close } = await session.push(chunk);
      for (const line of lines) {
        socket.write(line);
      }
      if (close) {
        socket.end();
      }
    });
  });
  socket.on('error', () => undefined);
}

/**
 * Bind a bare server on a path, rejecting rather than serving.
 *
 * @param {string} path - The endpoint to bind.
 * @returns {Promise<Server>} The bound server.
 */
function rawListen(path: string): Promise<Server> {
  const server = createServer();
  return new Promise<Server>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => resolve(server));
  });
}

/**
 * Whether a live server answers a connection at the endpoint.
 *
 * @param {string} path - The endpoint to probe.
 * @returns {Promise<boolean>} True when something accepts and does not error.
 */
function probeLive(path: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = connect(path);
    const settle = (live: boolean): void => {
      socket.destroy();
      resolve(live);
    };
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
    setTimeout(() => settle(false), 300).unref();
  });
}

/**
 * Claim the endpoint by binding it. If it is already in use, probe first: a live
 * daemon is left untouched and this rejects; only a stale socket with nothing
 * behind it is reaped and rebound. The bind is the single-daemon guarantee.
 *
 * @param {string} path - The endpoint to claim.
 * @param {BindSeams} [seams] - Injectable listen/probe/unlink.
 * @returns {Promise<Server>} The bound server; rejects when a live daemon holds it.
 */
export async function bindSocket(path: string, seams: BindSeams = {}): Promise<Server> {
  const listen = seams.listen ?? rawListen;
  const probe = seams.probe ?? probeLive;
  try {
    return await listen(path);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
      throw err;
    }
    if (await probe(path)) {
      throw new Error(`a PAW daemon is already bound at ${path}`);
    }
    reapSocket(path);
    return listen(path);
  }
}

/**
 * Serve a fresh session per connection on an already-bound server.
 *
 * @param {Server} server - A server from {@link bindSocket}.
 * @param {() => RpcSession} makeSession - Produces a session per connection.
 * @returns {SocketServerHandle} The running server.
 */
export function serveSessions(server: Server, makeSession: () => RpcSession): SocketServerHandle {
  server.on('connection', (socket: Socket) => attachSession(socket, makeSession()));
  return { close: () => new Promise<void>((done) => server.close(() => done())) };
}

/**
 * Claim the endpoint and serve sessions on it.
 *
 * @param {string} path - The endpoint to bind.
 * @param {() => RpcSession} makeSession - Produces a session per connection.
 * @param {BindSeams} [seams] - Injectable bind seams.
 * @returns {Promise<SocketServerHandle>} The running server; rejects if a live daemon holds the endpoint.
 */
export async function listenSocket(
  path: string,
  makeSession: () => RpcSession,
  seams?: BindSeams,
): Promise<SocketServerHandle> {
  const server = await bindSocket(path, seams);
  return serveSessions(server, makeSession);
}
