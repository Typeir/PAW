/**
 * PAW Console TLS Server
 *
 * @fileoverview Socket daemon serve console over. Loopback TLS server. Answer with router. Drop connection that sends headers too slowly. Return opaque errors. Upgrade socket to WebSocket only after daemon `check` hook approves. Adopt it into the WebSocket session. Send pings to keep it alive. Decisions are in `sessions`/`serve`; this file connects them to `node:https` and `ws`.
 *
 * @module @paw/daemon/infrastructure/http/consoleServer
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { STATUS_CODES, type IncomingMessage, type ServerResponse } from 'node:http';
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
import { CONTROL_BODY_CAP, isWriteMethod } from '../../domain/control.js';
import type { UpgradeRefusal } from '../security.js';
import type { AcceptedSocket, ServerHandle, SocketHooks, TlsMaterial } from '../../application/daemonContracts.js';
import type { WsSessionPort } from '../../domain/session.js';
import { firstHeader, offeredProtocols, toRequest } from './httpMessage.js';

/** IPv6 loopback. Daemon bind it next to IPv4 one. */
export const LOOPBACK_V6 = '::1';

/** How long client may take to send request headers. */
const HEADERS_TIMEOUT_MS = 5_000;

/** How long whole request take before server drops it. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Floor TLS version daemon negotiate. */
const MIN_TLS = 'TLSv1.2';

/**
 * Read request body off socket. Refuse at cap. Count bytes as they stream. Reject on chunk that cross cap.
 *
 * @param {AsyncIterable<Buffer | string>} source - Request stream.
 * @param {number} cap - Biggest body to buffer, in bytes.
 * @returns {Promise<{ ok: true; body: string } | { ok: false }>} Body, or overflow.
 */
export async function readBody(
  source: AsyncIterable<Buffer | string>,
  cap: number,
): Promise<{ ok: true; body: string } | { ok: false }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buf.length;
    if (size > cap) {
      return { ok: false };
    }
    chunks.push(buf);
  }
  return { ok: true, body: Buffer.concat(chunks).toString('utf8') };
}

/**
 * Turn one request into one response. Buffer write body under cap. Route it. Write what router return. Body over cap is 413 before routing. Body read only for write. Any thrown error is opaque 500.
 *
 * @param {IncomingMessage} req - Incoming request.
 * @param {ServerResponse} res - Response to write.
 * @param {string} host - Bound host. Resolve relative URL against it.
 * @param {(request: HttpRequest) => Promise<HttpResponse>} handler - Router.
 * @returns {Promise<void>} When response written.
 */
export async function answerRequest(
  req: IncomingMessage,
  res: ServerResponse,
  host: string,
  handler: (request: HttpRequest) => Promise<HttpResponse>,
): Promise<void> {
  try {
    let body: string | undefined;
    if (isWriteMethod(req.method ?? 'GET')) {
      const read = await readBody(req, CONTROL_BODY_CAP);
      if (!read.ok) {
        res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('payload too large');
        return;
      }
      body = read.body;
    }
    const routed = await handler(toRequest(req, host, body));
    res.writeHead(routed.status, routed.headers);
    res.end(routed.body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`pawd: request failed: ${message}\n`);
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('internal error');
  }
}

/**
 * TLS server. Answer with router. Drop connection that sends headers too slowly. Return opaque errors.
 *
 * @param {TlsMaterial} tls - Certificate and key to present.
 * @param {(request: HttpRequest) => Promise<HttpResponse>} handler - Router.
 * @param {string} host - Bound host. Resolve relative URL against it.
 * @returns {TlsServer} Unbound server.
 */
export function createConsoleServer(
  tls: TlsMaterial,
  handler: (request: HttpRequest) => Promise<HttpResponse>,
  host: string,
): TlsServer {
  const server = createServer({ cert: tls.cert, key: tls.key, minVersion: MIN_TLS }, (req, res) => {
    void answerRequest(req, res, host, handler);
  });
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  return server;
}

/**
 * Refuse upgrade while still plain HTTP. Write response by hand. `node:http` passes the raw socket to the upgrade handler. Set `Connection: close` and explicit `Content-Length`.
 *
 * @param {Duplex} socket - Raw socket.
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
 * Connect upgraded socket to the WebSocket session. Send a ping every {@link PING_MS} and require a pong within {@link PONG_TIMEOUT_MS}, terminate socket otherwise. Refuse binary frames; protocol is JSON text.
 *
 * @param {WebSocket} ws - Upgraded socket.
 * @param {SocketHooks} hooks - Daemon half.
 * @param {(message: string) => void} warn - Report failure without dying of it.
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
 * Attach WebSocket handler to bound server. Server upgrades nothing until {@link SocketHooks.check} approves. `handleProtocols` echoes daemon subprotocol. Refusal happens in the check hook.
 *
 * @param {TlsServer} server - Bound server.
 * @param {SocketHooks} hooks - Daemon half.
 * @param {(message: string) => void} warn - Report failure without dying of it.
 * @returns {WebSocketServer} Attached server, for shutdown.
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
 * Bind server. Reject if it cannot take address. `error` after binding reported and survived.
 *
 * @param {TlsServer} server - Server to bind.
 * @param {number} port - Port.
 * @param {string} host - Address.
 * @param {boolean} ipv6Only - Refuse v4-mapped connections on it.
 * @returns {Promise<void>} Resolve once bound.
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
 * Stop server listening.
 *
 * @param {TlsServer} server - Server.
 * @returns {Promise<void>} Resolve once closed.
 */
export function closeServer(server: TlsServer): Promise<void> {
  return new Promise<void>((done, fail) => {
    server.close((err) => (err ? fail(err) : done()));
  });
}

/**
 * Bind IPv6 loopback next to IPv4 one, same port. Failure reported and survived. Log symptom (`https://localhost` fail while `https://127.0.0.1` work).
 *
 * @param {TlsServer} server - Second server.
 * @param {number} port - Port IPv4 bound.
 * @returns {Promise<boolean>} True when listening.
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
