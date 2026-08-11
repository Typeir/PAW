/**
 * @fileoverview Test per-connection wiring. Use fake socket. Write branch,
 * close-on-session-say-so branch, error-swallow branch all run deterministically.
 * No coax real socket into reset. Real bind/accept/close path live in integration
 * tier.
 *
 * @module @paw/daemon/test/socketServer
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRpcSession } from '../src/application/rpcSession.js';
import {
  attachSession,
  bindSocket,
  reapSocket,
  type ConnSocket,
} from '../src/infrastructure/socketServer.js';

const addrInUse = (): NodeJS.ErrnoException => {
  const err = new Error('address already in use') as NodeJS.ErrnoException;
  err.code = 'EADDRINUSE';
  return err;
};

const fakeServer = () => ({ close: (cb: () => void) => cb() }) as unknown as Server;

const session = () =>
  createRpcSession({
    token: 'T',
    protocolVersion: 1,
    hello: { ok: true },
    methods: { echo: async (p) => p },
  });

const line = (obj: unknown): string => `${JSON.stringify(obj)}\n`;
const connect = (token = 'T') =>
  line({ jsonrpc: '2.0', id: 1, method: 'connect', params: { token, protocolVersion: 1 } });

/** Fake socket. Grab writes, end, and data/error handlers. */
function fakeSocket() {
  const handlers: { data?: (c: string) => void; error?: (e: Error) => void } = {};
  const written: string[] = [];
  let ended = false;
  const socket: ConnSocket = {
    setEncoding: () => undefined,
    on(event, listener) {
      if (event === 'data') {
        handlers.data = listener as (c: string) => void;
      } else {
        handlers.error = listener as (e: Error) => void;
      }
    },
    write: (d) => {
      written.push(d);
    },
    end: () => {
      ended = true;
    },
  };
  return { socket, handlers, written, isEnded: () => ended };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('attachSession', () => {
  it('writes the session output for a chunk and does not close a good handshake', async () => {
    const f = fakeSocket();
    attachSession(f.socket, session());
    f.handlers.data?.(connect());
    await flush();
    expect(JSON.parse(f.written[0]).result).toEqual({ ok: true });
    expect(f.isEnded()).toBe(false);
  });

  it('ends the socket when the session refuses', async () => {
    const f = fakeSocket();
    attachSession(f.socket, session());
    f.handlers.data?.(connect('wrong'));
    await flush();
    expect(JSON.parse(f.written[0]).error.code).toBe(-32600);
    expect(f.isEnded()).toBe(true);
  });

  it('swallows a socket error rather than throwing', () => {
    const f = fakeSocket();
    attachSession(f.socket, session());
    expect(() => f.handlers.error?.(new Error('reset'))).not.toThrow();
  });
});

describe('bindSocket — the single-daemon claim', () => {
  it('reaps a stale socket and rebinds when nothing is live', async () => {
    let attempts = 0;
    const server = await bindSocket('/tmp/paw-stale.sock', {
      listen: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw addrInUse();
        }
        return fakeServer();
      },
      probe: async () => false,
    });
    expect(attempts).toBe(2);
    expect(server).toBeDefined();
  });

  it('aborts without disturbing a live daemon', async () => {
    await expect(
      bindSocket('/tmp/paw-live.sock', {
        listen: async () => {
          throw addrInUse();
        },
        probe: async () => true,
      }),
    ).rejects.toThrow('already bound');
  });

  it('propagates a bind error that is not address-in-use', async () => {
    await expect(
      bindSocket('/tmp/paw-eacces.sock', {
        listen: async () => {
          throw new Error('EACCES: permission denied');
        },
      }),
    ).rejects.toThrow('EACCES');
  });
});

describe('reapSocket', () => {
  it('removes a socket file and tolerates its absence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paw-reap-'));
    const file = join(dir, 'x.sock');
    writeFileSync(file, '');
    reapSocket(file);
    expect(existsSync(file)).toBe(false);
    reapSocket(file);
    rmSync(dir, { recursive: true, force: true });
  });
});
