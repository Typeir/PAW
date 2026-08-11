/**
 * @fileoverview Unit test for one connection RPC session. Push NDJSON chunk, no socket. Pin handshake gate: refuse non-connect first frame, bad token, old or missing protocol; accept good one. Pin post-handshake routing: unknown method, served method, throwing method. Ignore non-request frames. Buffer across split. Refusal go dead. So `rpcSession.ts` reach 100%.
 *
 * @module @paw/daemon/test/rpcSession
 */

import { describe, expect, it } from 'vitest';
import { createRpcSession, type RpcSessionContext } from '../src/application/rpcSession.js';

const ctx = (): RpcSessionContext => ({
  token: 'secret-token',
  protocolVersion: 1,
  hello: { protocolVersion: 1, health: 'ok' },
  methods: {
    echo: async (params) => ({ echoed: params }),
    boom: async () => {
      throw new Error('kaboom');
    },
    boomStr: async () => {
      throw 'plain-string';
    },
  },
});

/** Encode one client frame as one NDJSON line. */
const line = (obj: unknown): string => `${JSON.stringify(obj)}\n`;

const connect = (over: Record<string, unknown> = {}) =>
  line({ jsonrpc: '2.0', id: 1, method: 'connect', params: { token: 'secret-token', protocolVersion: 1, ...over } });

/** Decode single result/error of push's first line. */
const decode = (lines: string[]) => JSON.parse(lines[0]) as { result?: unknown; error?: { code: number; message: string } };

describe('rpcSession — handshake gate', () => {
  it('accepts a good handshake and then serves a method', async () => {
    const s = createRpcSession(ctx());
    const hello = await s.push(connect());
    expect(hello.close).toBe(false);
    expect(decode(hello.lines).result).toEqual({ protocolVersion: 1, health: 'ok' });

    const call = await s.push(line({ jsonrpc: '2.0', id: 2, method: 'echo', params: { a: 1 } }));
    expect(decode(call.lines).result).toEqual({ echoed: { a: 1 } });
  });

  it('refuses a first frame that is not connect, and closes', async () => {
    const s = createRpcSession(ctx());
    const r = await s.push(line({ jsonrpc: '2.0', id: 9, method: 'echo', params: {} }));
    expect(r.close).toBe(true);
    expect(decode(r.lines).error?.code).toBe(-32600);
  });

  it('refuses a bad token, and closes', async () => {
    const r = await createRpcSession(ctx()).push(connect({ token: 'wrong' }));
    expect(r.close).toBe(true);
    expect(decode(r.lines).error?.message).toContain('unauthorized');
  });

  it('refuses a connect with no params at all', async () => {
    const r = await createRpcSession(ctx()).push(line({ jsonrpc: '2.0', id: 1, method: 'connect' }));
    expect(r.close).toBe(true);
    expect(decode(r.lines).error?.code).toBe(-32600);
  });

  it('refuses an old protocol with -32001, and closes', async () => {
    const r = await createRpcSession(ctx()).push(connect({ protocolVersion: 0 }));
    expect(r.close).toBe(true);
    expect(decode(r.lines).error?.code).toBe(-32001);
  });

  it('treats a missing protocol as too old', async () => {
    const r = await createRpcSession(ctx()).push(connect({ protocolVersion: undefined }));
    expect(r.close).toBe(true);
    expect(decode(r.lines).error?.code).toBe(-32001);
  });
});

describe('rpcSession — routing', () => {
  const authed = async () => {
    const s = createRpcSession(ctx());
    await s.push(connect());
    return s;
  };

  it('faults an unknown method with -32601', async () => {
    const s = await authed();
    const r = await s.push(line({ jsonrpc: '2.0', id: 3, method: 'nope', params: {} }));
    expect(r.close).toBe(false);
    expect(decode(r.lines).error?.code).toBe(-32601);
  });

  it('faults a throwing method with -32603 and its message', async () => {
    const s = await authed();
    const r = await s.push(line({ jsonrpc: '2.0', id: 4, method: 'boom', params: {} }));
    expect(decode(r.lines).error).toMatchObject({ code: -32603, message: 'kaboom' });
  });

  it('stringifies a non-Error throw', async () => {
    const s = await authed();
    const r = await s.push(line({ jsonrpc: '2.0', id: 7, method: 'boomStr', params: {} }));
    expect(decode(r.lines).error?.message).toBe('plain-string');
  });
});

describe('rpcSession — ignored frames, buffering, death', () => {
  it('ignores malformed, a result frame, and a notification', async () => {
    const s = createRpcSession(ctx());
    expect((await s.push('{not json\n')).lines).toHaveLength(0);
    expect((await s.push(line({ jsonrpc: '2.0', id: 5, result: {} }))).lines).toHaveLength(0);
    expect((await s.push(line({ jsonrpc: '2.0', method: 'event', params: {} }))).lines).toHaveLength(0);
  });

  it('buffers a frame split across two chunks', async () => {
    const s = createRpcSession(ctx());
    const whole = connect();
    const half = Math.floor(whole.length / 2);
    expect((await s.push(whole.slice(0, half))).lines).toHaveLength(0);
    const rest = await s.push(whole.slice(half));
    expect(decode(rest.lines).result).toBeDefined();
  });

  it('goes dead after a refusal', async () => {
    const s = createRpcSession(ctx());
    await s.push(connect({ token: 'wrong' }));
    expect(await s.push(line({ jsonrpc: '2.0', id: 6, method: 'echo' }))).toEqual({ lines: [], close: true });
  });
});
