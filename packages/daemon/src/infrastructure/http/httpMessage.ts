/**
 * PAW HTTP Message Parsing
 *
 * @fileoverview Pure parse. Node `IncomingMessage` into shapes daemon reads — routed request,
 * single header value, bound port, disclosed process row, offered subprotocols. No socket, no
 * effect: half of `nodeRuntime` testable without binding, separate from server that spawn sockets.
 *
 * @module @paw/daemon/infrastructure/http/httpMessage
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { IncomingMessage } from 'node:http';
import type { HostProcess } from '@paw/core';
import type { HttpRequest } from '../../domain/router.js';

/**
 * Route request line to method and path, read query too.
 *
 * @param {string | undefined} method - `req.method`.
 * @param {string | undefined} url - `req.url`.
 * @param {string} host - Bound host, resolve URL against it.
 * @returns {{ method: string; path: string; query: URLSearchParams }} Routed target.
 */
export function requestTarget(
  method: string | undefined,
  url: string | undefined,
  host: string,
): { method: string; path: string; query: URLSearchParams } {
  const parsed = new URL(url ?? '/', `http://${host}`);
  return {
    method: method ?? 'GET',
    path: parsed.pathname,
    query: parsed.searchParams,
  };
}

/**
 * First value of header Node parse into list. First win for repeated `Host` or `Origin`.
 *
 * @param {string | string[] | undefined} value - Parsed header.
 * @returns {string | undefined} Single value.
 */
export function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Assemble request router read from Node incoming message. Body read from socket by server and
 * passed in, so this stay pure function of message and already-buffered body.
 *
 * @param {IncomingMessage} req - Incoming request.
 * @param {string} host - Bound host, resolve relative URL against it.
 * @param {string} [body] - Buffered request body, for write.
 * @returns {HttpRequest} Routed request.
 */
export function toRequest(req: IncomingMessage, host: string, body?: string): HttpRequest {
  const target = requestTarget(req.method, req.url, host);
  return {
    method: target.method,
    path: target.path,
    query: target.query,
    body,
    headers: {
      authorization: firstHeader(req.headers.authorization),
      origin: firstHeader(req.headers.origin),
      host: firstHeader(req.headers.host),
      contentType: firstHeader(req.headers['content-type']),
    },
  };
}

/**
 * Port server bound. Node reports object for TCP socket, string for pipe; requested port
 * is fallback for anything else.
 *
 * @param {string | { port: number } | null} address - `server.address()`.
 * @param {number} fallback - Requested port.
 * @returns {number} Bound port.
 */
export function boundPort(address: string | { port: number } | null, fallback: number): number {
  return address !== null && typeof address === 'object' ? address.port : fallback;
}

/**
 * Narrow one `ps-list` row to three fields control API disclose. Row whose parent OS not report
 * roots at 0, which leave it outside PAW subtree — the subtree is what get served.
 *
 * @param {{ pid: number; ppid?: number; name: string }} proc - `ps-list` row.
 * @returns {HostProcess} Disclosed process.
 */
export function toHostProcess(proc: { pid: number; ppid?: number; name: string }): HostProcess {
  return { pid: proc.pid, ppid: proc.ppid ?? 0, name: proc.name };
}

/**
 * Subprotocols client offered, from raw header. Comma-separated list is wire format; absent header
 * mean offer none, which upgrade gate refuse.
 *
 * @param {string | undefined} header - `Sec-WebSocket-Protocol`.
 * @returns {string[]} Offered subprotocols.
 */
export function offeredProtocols(header: string | undefined): string[] {
  if (header === undefined) {
    return [];
  }
  return header
    .split(',')
    .map((protocol) => protocol.trim())
    .filter((protocol) => protocol !== '');
}
