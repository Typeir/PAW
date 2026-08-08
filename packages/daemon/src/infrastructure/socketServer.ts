/**
 * PAW Daemon Socket Server
 *
 * @fileoverview The `node:net` transport under the RPC session — the one place
 * that moves bytes (doc 10 §4). It binds the named pipe / unix socket and, per
 * connection, feeds received chunks to a fresh {@link RpcSession}, writes the
 * lines it returns, and ends the socket when the session says to. Pushes are
 * chained so rapid chunks cannot interleave the session's buffer. Stale-socket
 * reaping is the client's job (doc 10 §9b), so this assumes a clean path and
 * rejects if one is already bound.
 *
 * `attachSession` is the per-connection wiring, taken as a narrow interface so
 * its close/error branches test against a fake rather than a coaxed real socket.
 *
 * @module @paw/daemon/infrastructure/socketServer
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { createServer, type Socket } from 'node:net';
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
 * Bind the endpoint and serve a fresh session per connection.
 *
 * @param {string} path - The socket path or pipe name to bind.
 * @param {() => RpcSession} makeSession - Produces a session per connection.
 * @returns {Promise<SocketServerHandle>} The running server; rejects if the path is already bound.
 */
export function listenSocket(
  path: string,
  makeSession: () => RpcSession,
): Promise<SocketServerHandle> {
  const server = createServer((socket: Socket) => attachSession(socket, makeSession()));
  return new Promise<SocketServerHandle>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      resolve({
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
