/**
 * PAW HTTP Message Parsing
 *
 * @fileoverview The pure parsing between Node's `IncomingMessage` and the shapes
 * the daemon reasons over — the routed request, a single header value, the bound
 * port, a disclosed process row, the offered subprotocols. No socket and no
 * effect: it is the half of `nodeRuntime` that can be read by eye and tested
 * without binding anything, kept apart from the server that spawns real sockets.
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
 * Route a request line to a method and path, reading the query too.
 *
 * @param {string | undefined} method - `req.method`.
 * @param {string | undefined} url - `req.url`.
 * @param {string} host - The bound host, to resolve the URL against.
 * @returns {{ method: string; path: string; query: URLSearchParams }} The routed target.
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
 * The first value of a header Node may have parsed into a list. A repeated
 * `Host` or `Origin` is a smuggling smell rather than a merge candidate, so the
 * first wins and the security gates judge one unambiguous value.
 *
 * @param {string | string[] | undefined} value - The parsed header.
 * @returns {string | undefined} The single value.
 */
export function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Assemble the request the router reads from Node's incoming message. The body is
 * read from the socket by the server and passed in, so this stays a pure function
 * of the message and the already-buffered body.
 *
 * @param {IncomingMessage} req - The incoming request.
 * @param {string} host - The bound host, to resolve a relative URL against.
 * @param {string} [body] - The buffered request body, for a write.
 * @returns {HttpRequest} The routed request.
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
 * The port a server actually bound. Node reports an object for a TCP socket and
 * a string for a pipe; the requested port is the fallback for anything else.
 *
 * @param {string | { port: number } | null} address - `server.address()`.
 * @param {number} fallback - The port that was requested.
 * @returns {number} The bound port.
 */
export function boundPort(address: string | { port: number } | null, fallback: number): number {
  return address !== null && typeof address === 'object' ? address.port : fallback;
}

/**
 * Narrow one `ps-list` row to the three fields the control API discloses. A row
 * whose parent the OS did not report is rooted at 0, which leaves it outside
 * PAW's subtree — the safe direction, since the subtree is what gets served.
 *
 * @param {{ pid: number; ppid?: number; name: string }} proc - The `ps-list` row.
 * @returns {HostProcess} The disclosed process.
 */
export function toHostProcess(proc: { pid: number; ppid?: number; name: string }): HostProcess {
  return { pid: proc.pid, ppid: proc.ppid ?? 0, name: proc.name };
}

/**
 * The subprotocols a client offered, from the raw header. A comma-separated list
 * is the wire format; an absent header means it offered none, which the upgrade
 * gate refuses.
 *
 * @param {string | undefined} header - `Sec-WebSocket-Protocol`.
 * @returns {string[]} The offered subprotocols.
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
