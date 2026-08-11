/**
 * PAW Enforcement RPC Wire
 *
 * @fileoverview The `pawd` local-socket contract: JSON-RPC 2.0 over
 * newline-delimited JSON, the transport hooks and the CLI use to reach the
 * resident daemon. Frames are NDJSON (doc 10 §5).
 *
 * Parser be allow-list, like {@link module:@paw/core/domain/liveWire}.
 * {@link parseFrame} build new frame from the envelope fields it recognise
 * and return null otherwise. It never return caller parsed object. Method
 * params stay opaque; connector allow-list them downstream.
 *
 * @module @paw/core/domain/rpcWire
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * The one integer bump on any breaking change to method catalogue.
 */
export const RPC_PROTOCOL_VERSION = 1;

/**
 * The error codes pawd return: the standard JSON-RPC set plus PAW own, each
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
 * Method call await result.
 *
 * @interface RpcRequest
 * @property {'2.0'} jsonrpc - Protocol tag.
 * @property {number} id - Correlate response.
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
 * One-way event, no response (the daemon `daemon.subscribe` stream).
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
 * Successful result for request id.
 *
 * @interface RpcSuccess
 * @property {'2.0'} jsonrpc - Protocol tag.
 * @property {number} id - Request this answers.
 * @property {unknown} result - Opaque result value.
 */
export interface RpcSuccess {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly result: unknown;
}

/**
 * Failure body.
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
 * Failure for request id.
 *
 * @interface RpcFailure
 * @property {'2.0'} jsonrpc - Protocol tag.
 * @property {number} id - Request this answers.
 * @property {RpcErrorBody} error - Failure body.
 */
export interface RpcFailure {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly error: RpcErrorBody;
}

/**
 * Any frame can cross wire.
 */
export type RpcFrame = RpcRequest | RpcNotification | RpcSuccess | RpcFailure;

/**
 * Serialise frame to single NDJSON line, newline included.
 *
 * @param {RpcFrame} frame - Frame to send.
 * @returns {string} Line to write to socket.
 */
export function encodeFrame(frame: RpcFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

/**
 * Split accumulated socket bytes into complete lines and trailing partial.
 * Caller keep `rest` and prepend next chunk to it.
 *
 * @param {string} buffer - Bytes received so far.
 * @returns {{ lines: string[]; rest: string }} Complete lines and remainder.
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
 * Parse one NDJSON line into recognised frame, or null. Allow-list: only
 * envelope fields copied onto fresh object; caller parsed JSON never returned.
 *
 * @param {string} line - One NDJSON line, without terminator.
 * @returns {RpcFrame | null} Frame, or null when unrecognised or malformed.
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
 * Build request frame.
 *
 * @param {number} id - Correlation id.
 * @param {string} method - Namespaced method.
 * @param {unknown} [params] - Method parameters.
 * @returns {RpcRequest} Frame.
 */
export function rpcRequest(id: number, method: string, params?: unknown): RpcRequest {
  return { jsonrpc: '2.0', id, method, params };
}

/**
 * Build success frame.
 *
 * @param {number} id - Request answered.
 * @param {unknown} result - Result value.
 * @returns {RpcSuccess} Frame.
 */
export function rpcSuccess(id: number, result: unknown): RpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

/**
 * Build failure frame.
 *
 * @param {number} id - Request answered.
 * @param {number} code - A {@link RPC_ERROR} code.
 * @param {string} message - Reason.
 * @param {unknown} [data] - Optional detail.
 * @returns {RpcFailure} Frame.
 */
export function rpcFailure(id: number, code: number, message: string, data?: unknown): RpcFailure {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

/**
 * Build notification (event) frame.
 *
 * @param {string} method - Namespaced event name.
 * @param {unknown} [params] - Event payload.
 * @returns {RpcNotification} Frame.
 */
export function rpcNotification(method: string, params?: unknown): RpcNotification {
  return { jsonrpc: '2.0', method, params };
}
