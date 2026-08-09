/**
 * @fileoverview Unit tests for the daemon client, driven through a fake socket so
 * every fail-open path is deterministic: a good round trip returns the result;
 * a missing token, a connection error, an error frame, a malformed frame, and a
 * timeout each resolve to null; and a late event after settling is ignored. Two
 * cases omit an injected seam so the real default runs — reading a token from
 * disk, and opening a real socket — both against dead endpoints so they fail open
 * fast. So `rpcClient.ts` reaches 100% without a live pipe.
 *
 * @module @paw/daemon/test/rpcClient
 */

import type { Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { encodeFrame, rpcFailure, rpcSuccess } from '@paw/core';
import { rpcCall } from '../src/infrastructure/rpcClient.js';

/** A fake socket whose events the test drives directly. */
function fakeSocket() {
  const listeners: Record<string, ((arg: never) => void)[]> = {};
  const written: string[] = [];
  const socket = {
    setEncoding: () => undefined,
    on(event: string, fn: (arg: never) => void) {
      (listeners[event] ??= []).push(fn);
      return socket;
    },
    write: (d: string) => written.push(d),
    destroy: () => undefined,
  };
  return {
    socket: socket as unknown as Socket,
    emit: (event: string, arg?: unknown) => (listeners[event] ?? []).forEach((f) => (f as (a: unknown) => void)(arg)),
    written,
  };
}

const ok = (id: number, result: unknown) => encodeFrame(rpcSuccess(id, result));

describe('rpcCall', () => {
  it('handshakes then returns the method result, ignoring a late event', async () => {
    const f = fakeSocket();
    const p = rpcCall('sock', 'tok', 'hook.dispatch', { x: 1 }, { connect: () => f.socket, readToken: () => 'T' });
    f.emit('connect');
    f.emit('data', ok(1, { health: 'ok' }));
    f.emit('data', ok(2, { kind: 'allow' }));
    f.emit('error', new Error('late'));
    expect(await p).toEqual({ kind: 'allow' });
    expect(f.written).toHaveLength(2);
  });

  it('fails open when the token cannot be read', async () => {
    const r = await rpcCall('sock', 'tok', 'm', {}, {
      connect: () => fakeSocket().socket,
      readToken: () => {
        throw new Error('no token');
      },
    });
    expect(r).toBeNull();
  });

  it('fails open on a connection error', async () => {
    const f = fakeSocket();
    const p = rpcCall('sock', 'tok', 'm', {}, { connect: () => f.socket, readToken: () => 'T' });
    f.emit('error', new Error('ECONNREFUSED'));
    expect(await p).toBeNull();
  });

  it('fails open on an error frame', async () => {
    const f = fakeSocket();
    const p = rpcCall('sock', 'tok', 'm', {}, { connect: () => f.socket, readToken: () => 'T' });
    f.emit('connect');
    f.emit('data', encodeFrame(rpcFailure(1, -32600, 'unauthorized')));
    expect(await p).toBeNull();
  });

  it('fails open on a malformed frame', async () => {
    const f = fakeSocket();
    const p = rpcCall('sock', 'tok', 'm', {}, { connect: () => f.socket, readToken: () => 'T' });
    f.emit('connect');
    f.emit('data', 'not json\n');
    expect(await p).toBeNull();
  });

  it('fails open on a timeout', async () => {
    const f = fakeSocket();
    const p = rpcCall('sock', 'tok', 'm', {}, { connect: () => f.socket, readToken: () => 'T', timeoutMs: 20 });
    f.emit('connect');
    expect(await p).toBeNull();
  });

  it('reads the token from disk when no reader is injected', async () => {
    const r = await rpcCall('sock', '/no/such/token', 'm', {}, { connect: () => fakeSocket().socket });
    expect(r).toBeNull();
  });

  it('opens a real socket when no connector is injected', async () => {
    const r = await rpcCall('/no/such/socket.sock', 'tok', 'm', {}, { readToken: () => 'T', timeoutMs: 200 });
    expect(r).toBeNull();
  });
});
