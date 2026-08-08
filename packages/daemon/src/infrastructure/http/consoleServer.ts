/**
 * PAW Console TLS Server
 *
 * @fileoverview The real socket the daemon serves the console over: a loopback
 * TLS server that answers with the router, refuses to hold a connection open on
 * a trickle of header bytes, and never tells a client why a request failed. It
 * upgrades a socket to the live wire only after the daemon's `check` hook has
 * said yes, adopts it into the session machine, and keeps it honest with a
 * heartbeat. The deciding is all in `sessions`/`serve`; this is the wiring that
 * turns their decisions into `node:https` and `ws`.
 *
 * @module @paw/daemon/infrastructure/http/consoleServer
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { STATUS_CODES } from 'node:http';
import { createServer, type Server as TlsServer } from 'node:https';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  CLOSE_MALFORMED,
  LIVE_SUBPROTOCOL,
  MAX_FRAME_BYTES,
  PING_MS,
  PONG_TIMEOUT_MS,
} from '@paw/core';
import type { HttpRequest, HttpResponse } from '../../domain/router.js';
import type { UpgradeRefusal } from '../security.js';
import type { AcceptedSocket, ServerHandle, SocketHooks, TlsMaterial } from '../../application/daemonContracts.js';
import type { WsSessionPort } from '../../domain/session.js';
import { firstHeader, offeredProtocols, toRequest } from './httpMessage.js';

/** The IPv6 loopback the daemon binds alongside the IPv4 one. */
export const LOOPBACK_V6 = '::1';

/** How long a client may take to send its request headers. */
const HEADERS_TIMEOUT_MS = 5_000;

/** How long a whole request may take before the server drops it. */
const REQUEST_TIMEOUT_MS = 15_000;

/** The floor TLS version the daemon negotiates. */
const MIN_TLS = 'TLSv1.2';

/**
 * A TLS server that answers with the router, refuses to hold a connection open
 * on a trickle of header bytes, and never tells a client why a request failed —
 * an error message from a control API is reconnaissance.
 *
 * @param {TlsMaterial} tls - The certificate and key to present.
 * @param {(request: HttpRequest) => Promise<HttpResponse>} handler - The router.
 * @param {string} host - The bound host, to resolve a relative URL against.
 * @returns {TlsServer} The unbound server.
 */
export function createConsoleServer(
  tls: TlsMaterial,
  handler: (request: HttpRequest) => Promise<HttpResponse>,
  host: string,
): TlsServer {
  const server = createServer({ cert: tls.cert, key: tls.key, minVersion: MIN_TLS }, (req, res) => {
    void handler(toRequest(req, host)).then(
      (routed) => {
        res.writeHead(routed.status, routed.headers);
        res.end(routed.body);
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`pawd: request failed: ${message}\n`);
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('internal error');
      },
    );
  });
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  return server;
}

/**
 * Refuse an upgrade while it is still plain HTTP. The response is written by hand
 * because Node hands over the raw socket; `Connection: close` and an explicit
 * `Content-Length` keep a client from waiting for a body that never comes.
 *
 * @param {Duplex} socket - The raw socket.
 * @param {UpgradeRefusal} refusal - Why.
 */
export function refuseUpgrade(socket: Duplex, refusal: UpgradeRefusal): void {
  const body = refusal.message;
  socket.write(
    `HTTP/1.1 ${refusal.status} ${STATUS_CODES[refusal.status] ?? 'Error'}\r\n` +
      'content-type: text/plain; charset=utf-8\r\n' +
      `content-length: ${Buffer.byteLength(body)}\r\n` +
      'connection: close\r\n' +
      '\r\n' +
      body,
  );
  socket.destroy();
}

/**
 * Wire an upgraded socket to the session machine, and keep it honest with a
 * heartbeat: a ping every {@link PING_MS} with a hard {@link PONG_TIMEOUT_MS}
 * deadline that terminates rather than closes, since a client that stopped
 * answering will not finish a closing handshake either. Binary frames are
 * refused — this protocol is JSON text, and a second decode path on a security
 * boundary is a second place to get it wrong.
 *
 * @param {WebSocket} ws - The upgraded socket.
 * @param {SocketHooks} hooks - The daemon's half.
 * @param {(message: string) => void} warn - Report a failure without dying of it.
 */
export function adoptSocket(
  ws: WebSocket,
  hooks: SocketHooks,
  warn: (message: string) => void,
): void {
  const port: WsSessionPort = {
    send: (text: string) => ws.send(text),
    close: (code: number, reason: string) => ws.close(code, reason),
    bufferedAmount: () => ws.bufferedAmount,
  };
  const session: AcceptedSocket = hooks.accept(port);

  let awaitingPong: NodeJS.Timeout | null = null;
  const heartbeat = setInterval(() => {
    if (awaitingPong !== null) {
      return;
    }
    ws.ping();
    awaitingPong = setTimeout(() => ws.terminate(), PONG_TIMEOUT_MS);
    awaitingPong.unref();
  }, PING_MS);
  heartbeat.unref();

  const stopTimers = (): void => {
    clearInterval(heartbeat);
    if (awaitingPong !== null) {
      clearTimeout(awaitingPong);
      awaitingPong = null;
    }
  };

  ws.on('pong', () => {
    if (awaitingPong !== null) {
      clearTimeout(awaitingPong);
      awaitingPong = null;
    }
  });

  ws.on('message', (data: unknown, isBinary: boolean) => {
    if (isBinary) {
      ws.close(CLOSE_MALFORMED, 'this protocol is text');
      return;
    }
    void session.message(String(data)).catch((err: unknown) => {
      warn(`live session failed: ${err instanceof Error ? err.message : String(err)}`);
      ws.close(CLOSE_MALFORMED, 'session error');
    });
  });

  ws.on('error', (err: Error) => {
    warn(`live socket error: ${err.message}`);
  });

  ws.on('close', () => {
    stopTimers();
    session.closed();
  });
}

/**
 * Attach the live wire to a bound server. The server upgrades nothing until
 * {@link SocketHooks.check} says yes; `handleProtocols` only echoes the
 * subprotocol the daemon speaks, and the real refusal happens in the gate.
 *
 * @param {TlsServer} server - The bound server.
 * @param {SocketHooks} hooks - The daemon's half.
 * @param {(message: string) => void} warn - Report a failure without dying of it.
 * @returns {WebSocketServer} The attached server, for shutdown.
 */
export function attachLiveWire(
  server: TlsServer,
  hooks: SocketHooks,
  warn: (message: string) => void,
): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
    perMessageDeflate: false,
    handleProtocols: () => LIVE_SUBPROTOCOL,
  });

  server.on('upgrade', (req, socket, head) => {
    const refusal = hooks.check({
      host: firstHeader(req.headers.host),
      origin: firstHeader(req.headers.origin),
      protocols: offeredProtocols(firstHeader(req.headers['sec-websocket-protocol'])),
    });
    if (refusal !== null) {
      refuseUpgrade(socket, refusal);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      adoptSocket(ws, hooks, warn);
    });
  });

  return wss;
}

/**
 * Bind a server, rejecting if it cannot take the address. An `error` after
 * binding is reported and survived rather than thrown — one broken connection is
 * not a reason to drop every other one.
 *
 * @param {TlsServer} server - The server to bind.
 * @param {number} port - The port.
 * @param {string} host - The address.
 * @param {boolean} ipv6Only - Whether to refuse v4-mapped connections on it.
 * @returns {Promise<void>} Resolves once bound.
 */
export function bindServer(
  server: TlsServer,
  port: number,
  host: string,
  ipv6Only: boolean,
): Promise<void> {
  return new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen({ port, host, ipv6Only }, () => {
      server.removeListener('error', fail);
      server.on('error', (err: Error) => {
        process.stderr.write(`pawd: socket error on ${host}:${port}: ${err.message}\n`);
      });
      done();
    });
  });
}

/**
 * Stop a server listening.
 *
 * @param {TlsServer} server - The server.
 * @returns {Promise<void>} Resolves once closed.
 */
export function closeServer(server: TlsServer): Promise<void> {
  return new Promise<void>((done, fail) => {
    server.close((err) => (err ? fail(err) : done()));
  });
}

/**
 * Bind the IPv6 loopback alongside the IPv4 one, on the same port. A failure is
 * reported and survived: the daemon is already reachable on `127.0.0.1`, and a
 * machine with IPv6 disabled is a configuration, not a fault — but the symptom
 * (`https://localhost` failing while `https://127.0.0.1` works) must never be
 * silent.
 *
 * @param {TlsServer} server - The second server.
 * @param {number} port - The port IPv4 bound.
 * @returns {Promise<boolean>} True when it is listening.
 */
export async function bindLoopbackV6(server: TlsServer, port: number): Promise<boolean> {
  try {
    await bindServer(server, port, LOOPBACK_V6, true);
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `pawd: could not also listen on [${LOOPBACK_V6}]:${port} (${message}). ` +
        `https://127.0.0.1:${port}/ works; https://localhost:${port}/ may not.\n`,
    );
    return false;
  }
}
