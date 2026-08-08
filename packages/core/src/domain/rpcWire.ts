/**
 * PAW Enforcement RPC Wire
 *
 * @fileoverview The `pawd` local-socket contract: JSON-RPC 2.0 over
 * newline-delimited JSON, the transport hooks and the CLI use to reach the one
 * resident daemon. NDJSON, not `Content-Length` framing — the frames are small
 * and a log line stays greppable (doc 10 §5).
 *
 * Like {@link module:@paw/core/domain/liveWire}, the parser is an ALLOW-LIST, not
 * a validator: {@link parseFrame} builds a new frame out of the envelope fields
 * it recognises and returns null for anything else. It never hands a caller's
 * parsed object onward — pawd holds decrypted credentials, so nothing crosses
 * this boundary that was not named here. Method params stay opaque and are the
 * connector's to allow-list downstream.
 *
 * @module @paw/core/domain/rpcWire
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * The single integer bumped on any breaking change to the method catalogue.
 */
export const RPC_PROTOCOL_VERSION = 1;

/**
 * The error codes pawd returns: the standard JSON-RPC set plus PAW's own, each
 * with a defined client action in the failure matrix (doc 10 §5, §10).
 */
export const RPC_ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  protocolTooOld: -32001,
  daemonStarting: -32002,
  secretLocked: -32003,
  roleUnbound: -32004,
} as const;

/**
 * A method call awaiting a result.
 *
 * @interface RpcRequest
 * @property {'2.0'} jsonrpc - Protocol tag.
 * @property {number} id - Correlates the response.
 * @property {string} method - Namespaced method name.
 * @property {unknown} [params] - Opaque method parameters.
 */
export interface RpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: string;
  readonly params?: unknown;
}

/**
 * A one-way event with no response (the daemon's `daemon.subscribe` stream).
 *
 * @interface RpcNotification
 * @property {'2.0'} jsonrpc - Protocol tag.
 * @property {string} method - Namespaced event name.
 * @property {unknown} [params] - Opaque event payload.
 */
export interface RpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: unknown;
}

/**
 * A successful result for a request id.
 *
 * @interface RpcSuccess
 * @property {'2.0'} jsonrpc - Protocol tag.
 * @property {number} id - The request this answers.
 * @property {unknown} result - Opaque result value.
 */
export interface RpcSuccess {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly result: unknown;
}

/**
 * A failure body.
 *
 * @interface RpcErrorBody
 * @property {number} code - A {@link RPC_ERROR} code.
 * @property {string} message - Human-readable reason.
 * @property {unknown} [data] - Optional structured detail.
 */
export interface RpcErrorBody {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/**
 * A failure for a request id.
 *
 * @interface RpcFailure
 * @property {'2.0'} jsonrpc - Protocol tag.
 * @property {number} id - The request this answers.
 * @property {RpcErrorBody} error - The failure body.
 */
export interface RpcFailure {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly error: RpcErrorBody;
}

/**
 * Any frame that can cross the wire.
 */
export type RpcFrame = RpcRequest | RpcNotification | RpcSuccess | RpcFailure;

/**
 * Serialise a frame to a single NDJSON line, newline included.
 *
 * @param {RpcFrame} frame - The frame to send.
 * @returns {string} The line to write to the socket.
 */
export function encodeFrame(frame: RpcFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

/**
 * Split accumulated socket bytes into complete lines and the trailing partial.
 * The caller keeps `rest` and prepends the next chunk to it.
 *
 * @param {string} buffer - Bytes received so far.
 * @returns {{ lines: string[]; rest: string }} Complete lines and the remainder.
 */
export function splitFrames(buffer: string): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let rest = buffer;
  let nl = rest.indexOf('\n');
  while (nl !== -1) {
    lines.push(rest.slice(0, nl));
    rest = rest.slice(nl + 1);
    nl = rest.indexOf('\n');
  }
  return { lines, rest };
}

/**
 * Parse one NDJSON line into a recognised frame, or null. An allow-list: only
 * the envelope fields are copied onto a fresh object; the caller's parsed JSON is
 * never returned.
 *
 * @param {string} line - One NDJSON line, without the terminator.
 * @returns {RpcFrame | null} The frame, or null when unrecognised or malformed.
 */
export function parseFrame(line: string): RpcFrame | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const f = raw as Record<string, unknown>;
  if (f.jsonrpc !== '2.0') {
    return null;
  }
  const hasId = typeof f.id === 'number';
  const method = typeof f.method === 'string' ? f.method : null;
  if (method !== null) {
    return hasId
      ? { jsonrpc: '2.0', id: f.id as number, method, params: f.params }
      : { jsonrpc: '2.0', method, params: f.params };
  }
  if (hasId && 'result' in f) {
    return { jsonrpc: '2.0', id: f.id as number, result: f.result };
  }
  if (hasId && typeof f.error === 'object' && f.error !== null) {
    const e = f.error as Record<string, unknown>;
    const body: RpcErrorBody = {
      code: Number(e.code),
      message: String(e.message),
      ...('data' in e ? { data: e.data } : {}),
    };
    return { jsonrpc: '2.0', id: f.id as number, error: body };
  }
  return null;
}

/**
 * Build a request frame.
 *
 * @param {number} id - Correlation id.
 * @param {string} method - Namespaced method.
 * @param {unknown} [params] - Method parameters.
 * @returns {RpcRequest} The frame.
 */
export function rpcRequest(id: number, method: string, params?: unknown): RpcRequest {
  return { jsonrpc: '2.0', id, method, params };
}

/**
 * Build a success frame.
 *
 * @param {number} id - The request answered.
 * @param {unknown} result - The result value.
 * @returns {RpcSuccess} The frame.
 */
export function rpcSuccess(id: number, result: unknown): RpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

/**
 * Build a failure frame.
 *
 * @param {number} id - The request answered.
 * @param {number} code - A {@link RPC_ERROR} code.
 * @param {string} message - The reason.
 * @param {unknown} [data] - Optional detail.
 * @returns {RpcFailure} The frame.
 */
export function rpcFailure(id: number, code: number, message: string, data?: unknown): RpcFailure {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

/**
 * Build a notification (event) frame.
 *
 * @param {string} method - Namespaced event name.
 * @param {unknown} [params] - Event payload.
 * @returns {RpcNotification} The frame.
 */
export function rpcNotification(method: string, params?: unknown): RpcNotification {
  return { jsonrpc: '2.0', method, params };
}
