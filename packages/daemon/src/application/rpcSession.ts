/**
 * PAW Daemon RPC Session
 *
 * @fileoverview One connection's protocol state, pure and socket-free: it buffers
 * NDJSON, requires a `connect` handshake carrying the daemon's token and a new
 * enough protocol before anything else, then routes method calls to handlers and
 * frames the results. Doc 10 §4–6. The transport ({@link module:@paw/daemon/infrastructure/socketServer})
 * only moves bytes; every decision — refuse a bad token, reject an old protocol,
 * answer or fault a method — is here, so all of it is tested without a pipe.
 *
 * A refused handshake closes the connection: `close` rides back with the fault
 * frame, and the session goes dead so a client cannot keep talking past a refusal.
 *
 * @module @paw/daemon/application/rpcSession
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  RPC_ERROR,
  encodeFrame,
  parseFrame,
  rpcFailure,
  rpcSuccess,
  splitFrames,
  type RpcRequest,
} from '@paw/core';

/**
 * What a session needs to serve one connection.
 *
 * @interface RpcSessionContext
 * @property {string} token - The handshake token every client must present.
 * @property {number} protocolVersion - The daemon's protocol; older clients are refused.
 * @property {unknown} hello - The `connect` result payload (version, root, capabilities, health).
 * @property {Record<string, (params: unknown) => Promise<unknown>>} methods - The method catalogue, post-handshake.
 */
export interface RpcSessionContext {
  readonly token: string;
  readonly protocolVersion: number;
  readonly hello: unknown;
  readonly methods: Record<string, (params: unknown) => Promise<unknown>>;
}

/**
 * The lines to write back for a chunk, and whether to close afterwards.
 *
 * @interface SessionPush
 * @property {string[]} lines - NDJSON lines to send.
 * @property {boolean} close - Destroy the connection after writing.
 */
export interface SessionPush {
  readonly lines: string[];
  readonly close: boolean;
}

/**
 * One connection's session.
 *
 * @interface RpcSession
 * @property {(chunk: string) => Promise<SessionPush>} push - Feed received bytes; get lines to write and whether to close.
 */
export interface RpcSession {
  push(chunk: string): Promise<SessionPush>;
}

/**
 * Create a session over a context.
 *
 * @param {RpcSessionContext} ctx - The token, protocol, hello, and methods.
 * @returns {RpcSession} A stateful, single-connection session.
 */
export function createRpcSession(ctx: RpcSessionContext): RpcSession {
  let buffer = '';
  let authed = false;
  let dead = false;

  const handshake = (req: RpcRequest): SessionPush => {
    if (req.method !== 'connect') {
      return { lines: [encodeFrame(rpcFailure(req.id, RPC_ERROR.invalidRequest, 'expected connect'))], close: true };
    }
    const p = (req.params ?? {}) as { token?: unknown; protocolVersion?: unknown };
    if (p.token !== ctx.token) {
      return { lines: [encodeFrame(rpcFailure(req.id, RPC_ERROR.invalidRequest, 'unauthorized'))], close: true };
    }
    const version = typeof p.protocolVersion === 'number' ? p.protocolVersion : 0;
    if (version < ctx.protocolVersion) {
      return { lines: [encodeFrame(rpcFailure(req.id, RPC_ERROR.protocolTooOld, 'protocol too old'))], close: true };
    }
    authed = true;
    return { lines: [encodeFrame(rpcSuccess(req.id, ctx.hello))], close: false };
  };

  const call = async (req: RpcRequest): Promise<SessionPush> => {
    const handler = ctx.methods[req.method];
    if (!handler) {
      return { lines: [encodeFrame(rpcFailure(req.id, RPC_ERROR.methodNotFound, `unknown method: ${req.method}`))], close: false };
    }
    try {
      const result = await handler(req.params);
      return { lines: [encodeFrame(rpcSuccess(req.id, result))], close: false };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { lines: [encodeFrame(rpcFailure(req.id, RPC_ERROR.internal, message))], close: false };
    }
  };

  const handle = (line: string): Promise<SessionPush> | SessionPush => {
    const frame = parseFrame(line);
    if (frame === null || !('method' in frame) || !('id' in frame)) {
      return { lines: [], close: false };
    }
    return authed ? call(frame) : handshake(frame);
  };

  return {
    async push(chunk: string): Promise<SessionPush> {
      if (dead) {
        return { lines: [], close: true };
      }
      buffer += chunk;
      const { lines, rest } = splitFrames(buffer);
      buffer = rest;
      const out: string[] = [];
      for (const line of lines) {
        const r = await handle(line);
        out.push(...r.lines);
        if (r.close) {
          dead = true;
          return { lines: out, close: true };
        }
      }
      return { lines: out, close: false };
    },
  };
}
