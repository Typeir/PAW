/**
 * PAW Daemon Socket Server
 *
 * @fileoverview `node:net` transport under RPC session (doc 10 §4), enforcing
 * single resident daemon via the endpoint claim. One process alone can bind a
 * pipe/socket; the OS enforces it — no removable lockfile. {@link bindSocket}
 * binds first and, on an in-use endpoint, PROBEs before anything: a live daemon
 * makes it abort; a stale POSIX socket with nothing behind it is reaped and
 * rebound (doc 10 §9b). Session wiring and any writes to `.paw` happen only
 * after claim succeeds, so a lost daemon writes nothing.
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
 * Running socket server.
 *
 * @interface SocketServerHandle
 * @property {() => Promise<void>} close - Stop accepting, release endpoint.
 */
export interface SocketServerHandle {
  close(): Promise<void>;
}

/**
 * Minimal socket surface {@link attachSession} drive.
 *
 * @interface ConnSocket
 * @property {(encoding: 'utf8') => void} setEncoding - Decode incoming chunks as text.
 * @property {(event: 'data' | 'error', listener: (arg: never) => void) => void} on - Subscribe to socket event.
 * @property {(data: string) => void} write - Send line.
 * @property {() => void} end - Half-close after flush.
 */
export interface ConnSocket {
  setEncoding(encoding: 'utf8'): void;
  on(event: 'data', listener: (chunk: string) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  write(data: string): void;
  end(): void;
}

/**
 * Injectable seams for {@link bindSocket}, so claim logic tests without a
 * pipe.
 *
 * @interface BindSeams
 * @property {(path: string) => Promise<Server>} [listen] - Bind bare server, reject if in use.
 * @property {(path: string) => Promise<boolean>} [probe] - Whether live server answer endpoint.
 */
export interface BindSeams {
  listen?(path: string): Promise<Server>;
  probe?(path: string): Promise<boolean>;
}

/**
 * Remove socket path, ignoring error when it does not exist — reap a
 * stale POSIX socket a crashed daemon left behind.
 *
 * @param {string} path - Socket path to remove.
 */
export function reapSocket(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* gone already */
  }
}

/**
 * Wire one connection to session: chunks in, framed lines out, closed when
 * session closes it. Pushes serialised so session sees chunks in order.
 *
 * @param {ConnSocket} socket - Connection.
 * @param {RpcSession} session - Fresh session.
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
 * Bind bare server on path; a failure rejects instead of serving.
 *
 * @param {string} path - Endpoint to bind.
 * @returns {Promise<Server>} Bound server.
 */
function rawListen(path: string): Promise<Server> {
  const server = createServer();
  return new Promise<Server>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => resolve(server));
  });
}

/**
 * Whether live server answer connection at endpoint.
 *
 * @param {string} path - Endpoint to probe.
 * @returns {Promise<boolean>} True when something accept and no error.
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
 * Bind endpoint, claiming single-daemon ownership. If already in use, probe
 * first: a live daemon makes this reject and stays untouched; only a stale
 * socket with nothing behind it is reaped and rebound.
 *
 * @param {string} path - Endpoint to claim.
 * @param {BindSeams} [seams] - Injectable listen/probe/unlink.
 * @returns {Promise<Server>} Bound server; reject when live daemon holds it.
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
 * Serve fresh session per connection on already-bound server.
 *
 * @param {Server} server - Server from {@link bindSocket}.
 * @param {() => RpcSession} makeSession - Produce session per connection.
 * @returns {SocketServerHandle} Running server.
 */
export function serveSessions(server: Server, makeSession: () => RpcSession): SocketServerHandle {
  server.on('connection', (socket: Socket) => attachSession(socket, makeSession()));
  return { close: () => new Promise<void>((done) => server.close(() => done())) };
}

/**
 * Claim endpoint and serve sessions on it.
 *
 * @param {string} path - Endpoint to bind.
 * @param {() => RpcSession} makeSession - Produce session per connection.
 * @param {BindSeams} [seams] - Injectable bind seams.
 * @returns {Promise<SocketServerHandle>} Running server; reject if live daemon holds endpoint.
 */
export async function listenSocket(
  path: string,
  makeSession: () => RpcSession,
  seams?: BindSeams,
): Promise<SocketServerHandle> {
  const server = await bindSocket(path, seams);
  return serveSessions(server, makeSession);
}
