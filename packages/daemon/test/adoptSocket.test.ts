/**
 * Socket Adoption Tests
 *
 * @fileoverview The heartbeat, and the failure paths a real socket only takes
 * when something has already gone wrong.
 *
 * These are unit tests over a stub socket because the alternative is not a
 * better test, it is a slower one: the ping interval is fifteen seconds and the
 * pong deadline ten, so an integration test would either sleep for half a minute
 * or assert nothing. Fake timers make the deadline exact — the assertion is that
 * a silent client is terminated at ten seconds, not that it is terminated
 * eventually.
 *
 * @module @paw/daemon/test/adoptSocket
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { CLOSE_MALFORMED, PING_MS, PONG_TIMEOUT_MS } from '@paw/core';
import type { Duplex } from 'node:stream';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adoptSocket, refuseUpgrade } from '../src/infrastructure/http/consoleServer.js';
import { offeredProtocols } from '../src/infrastructure/http/httpMessage.js';
import type { SocketHooks } from '../src/application/daemonContracts.js';
import type { WsSessionPort } from '../src/domain/session.js';

/**
 * A stub socket that records what was done to it and lets a test fire its events.
 *
 * @returns {object} The stub and its recordings.
 */
const stubSocket = (): {
  ws: WebSocket;
  fire(event: string, ...args: unknown[]): void;
  sent: string[];
  closed: Array<[number, string]>;
  pings: number;
  terminated: number;
} => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const stub = {
    sent: [] as string[],
    closed: [] as Array<[number, string]>,
    pings: 0,
    terminated: 0,
    bufferedAmount: 0,
    on(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return stub;
    },
    send(text: string) {
      stub.sent.push(text);
    },
    close(code: number, reason: string) {
      stub.closed.push([code, reason]);
    },
    ping() {
      stub.pings += 1;
    },
    terminate() {
      stub.terminated += 1;
    },
    fire(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
    },
  };
  // Object.assign so the returned handle IS the stub. Spreading would hand the
  // test a snapshot of the counters taken before a single ping was sent.
  return Object.assign(stub, { ws: stub as unknown as WebSocket }) as never;
};

/**
 * Hooks that hand back a session recording what it was told.
 *
 * @param {(raw: string) => Promise<void>} [onMessage] - What `message` does.
 * @returns {object} The hooks and their recordings.
 */
const stubHooks = (
  onMessage: (raw: string) => Promise<void> = async () => undefined,
): { hooks: SocketHooks; received: string[]; closes: number; port: WsSessionPort | null } => {
  const state = { received: [] as string[], closes: 0, port: null as WsSessionPort | null };
  return {
    get received() {
      return state.received;
    },
    get closes() {
      return state.closes;
    },
    get port() {
      return state.port;
    },
    hooks: {
      check: () => null,
      accept: (port: WsSessionPort) => {
        state.port = port;
        return {
          message: async (raw: string) => {
            state.received.push(raw);
            await onMessage(raw);
          },
          closed: () => {
            state.closes += 1;
          },
        };
      },
    },
  } as never;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('offeredProtocols', () => {
  it('reads a comma-separated list the way the handshake sends it', () => {
    expect(offeredProtocols('paw.live.v1')).toEqual(['paw.live.v1']);
    expect(offeredProtocols('chat, paw.live.v1')).toEqual(['chat', 'paw.live.v1']);
    expect(offeredProtocols('  paw.live.v1  ')).toEqual(['paw.live.v1']);
  });

  it('treats an absent or empty header as offering nothing', () => {
    expect(offeredProtocols(undefined)).toEqual([]);
    expect(offeredProtocols('')).toEqual([]);
    expect(offeredProtocols(' , ,')).toEqual([]);
  });
});

describe('refuseUpgrade', () => {
  /**
   * A socket that records what was written to it before being destroyed.
   *
   * @returns {object} The socket and its recordings.
   */
  const rawSocket = (): { socket: Duplex; written: string[]; destroyed: number } => {
    const state = { written: [] as string[], destroyed: 0 };
    return {
      get written() {
        return state.written;
      },
      get destroyed() {
        return state.destroyed;
      },
      socket: {
        write: (chunk: string) => state.written.push(chunk),
        destroy: () => {
          state.destroyed += 1;
        },
      } as unknown as Duplex,
    } as never;
  };

  it('answers with a complete HTTP response and hangs up', () => {
    const raw = rawSocket();
    refuseUpgrade(raw.socket, { status: 403, message: 'origin not allowed' });
    const [response] = raw.written;

    expect(response).toContain('HTTP/1.1 403 Forbidden');
    // Without a content-length and connection:close the client waits for a body
    // that never arrives, and "the daemon hung" is a far worse report than 403.
    expect(response).toContain('content-length: 18');
    expect(response).toContain('connection: close');
    expect(response.endsWith('\r\n\r\norigin not allowed')).toBe(true);
    expect(raw.destroyed).toBe(1);
  });

  it('still writes a well-formed response for a status Node has no name for', () => {
    const raw = rawSocket();
    refuseUpgrade(raw.socket, { status: 499, message: 'nope' });

    expect(raw.written[0]).toContain('HTTP/1.1 499 Error');
    expect(raw.destroyed).toBe(1);
  });
});

describe('the heartbeat on an adopted socket', () => {
  it('pings on schedule and terminates a client that never pongs', () => {
    const socket = stubSocket();
    adoptSocket(socket.ws, stubHooks().hooks, () => undefined);

    vi.advanceTimersByTime(PING_MS);
    expect(socket.pings).toBe(1);
    expect(socket.terminated).toBe(0);

    vi.advanceTimersByTime(PONG_TIMEOUT_MS - 1);
    expect(socket.terminated).toBe(0);

    vi.advanceTimersByTime(1);
    // Terminated, not closed: a client that stopped answering pings is not going
    // to complete a closing handshake either, and waiting leaks the session.
    expect(socket.terminated).toBe(1);
  });

  it('keeps pinging a client that answers', () => {
    const socket = stubSocket();
    adoptSocket(socket.ws, stubHooks().hooks, () => undefined);

    vi.advanceTimersByTime(PING_MS);
    socket.fire('pong');
    vi.advanceTimersByTime(PING_MS);
    socket.fire('pong');

    expect(socket.pings).toBe(2);
    expect(socket.terminated).toBe(0);
  });

  it('stops pinging a socket it already gave up on', () => {
    const socket = stubSocket();
    adoptSocket(socket.ws, stubHooks().hooks, () => undefined);

    vi.advanceTimersByTime(PING_MS);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS);
    expect(socket.terminated).toBe(1);

    // The interval is still running until `close` arrives. Pinging a socket that
    // was terminated for not answering is bytes at a client that is gone.
    vi.advanceTimersByTime(PING_MS * 3);
    expect(socket.pings).toBe(1);
  });

  it('ignores a pong nobody was waiting for', () => {
    const socket = stubSocket();
    adoptSocket(socket.ws, stubHooks().hooks, () => undefined);

    expect(() => socket.fire('pong')).not.toThrow();
    expect(socket.terminated).toBe(0);
  });

  it('stops its timers when the socket closes, mid-ping or not', () => {
    const socket = stubSocket();
    const hooks = stubHooks();
    adoptSocket(socket.ws, hooks.hooks, () => undefined);

    vi.advanceTimersByTime(PING_MS);
    socket.fire('close');

    vi.advanceTimersByTime(PING_MS * 10);
    // A timer that outlives its socket is a leak that terminates a socket
    // belonging to nobody, and pins the session in the registry forever.
    expect(socket.pings).toBe(1);
    expect(socket.terminated).toBe(0);
    expect(hooks.closes).toBe(1);
  });

  it('stops a clean socket’s timers too', () => {
    const socket = stubSocket();
    adoptSocket(socket.ws, stubHooks().hooks, () => undefined);

    socket.fire('close');
    vi.advanceTimersByTime(PING_MS * 3);

    expect(socket.pings).toBe(0);
  });
});

describe('an adopted socket’s frames', () => {
  it('hands a text frame to the session', async () => {
    const socket = stubSocket();
    const hooks = stubHooks();
    adoptSocket(socket.ws, hooks.hooks, () => undefined);

    socket.fire('message', Buffer.from('{"v":1,"m":"a","k":"x"}'), false);
    await vi.advanceTimersByTimeAsync(0);

    expect(hooks.received).toEqual(['{"v":1,"m":"a","k":"x"}']);
  });

  it('refuses a binary frame rather than growing a second decode path', async () => {
    const socket = stubSocket();
    const hooks = stubHooks();
    adoptSocket(socket.ws, hooks.hooks, () => undefined);

    socket.fire('message', Buffer.from([1, 2, 3]), true);
    await vi.advanceTimersByTimeAsync(0);

    expect(hooks.received).toEqual([]);
    expect(socket.closed).toEqual([[CLOSE_MALFORMED, 'this protocol is text']]);
  });

  it.each([
    ['an Error', new Error('the plan module vanished'), 'the plan module vanished'],
    ['a thrown value', 'socket went away', 'socket went away'],
  ])('reports a session that threw on %s and closes rather than hanging', async (
    _label,
    thrown,
    said,
  ) => {
    const socket = stubSocket();
    const warnings: string[] = [];
    const hooks = stubHooks(async () => {
      throw thrown;
    });
    adoptSocket(socket.ws, hooks.hooks, (message) => warnings.push(message));

    socket.fire('message', Buffer.from('{}'), false);
    await vi.advanceTimersByTimeAsync(0);

    expect(warnings).toEqual([`live session failed: ${said}`]);
    expect(socket.closed).toEqual([[CLOSE_MALFORMED, 'session error']]);
  });

  it('reports a socket error without taking the daemon down with it', () => {
    const socket = stubSocket();
    const warnings: string[] = [];
    adoptSocket(socket.ws, stubHooks().hooks, (message) => warnings.push(message));

    // An `error` with no listener is a thrown exception in Node. On a socket
    // that means one bad client kills the daemon for everyone.
    expect(() => socket.fire('error', new Error('ECONNRESET'))).not.toThrow();
    expect(warnings).toEqual(['live socket error: ECONNRESET']);
  });

  it('exposes the socket’s own buffer to the session, so backpressure is real', () => {
    const socket = stubSocket();
    const hooks = stubHooks();
    adoptSocket(socket.ws, hooks.hooks, () => undefined);

    hooks.port?.send('frame');
    hooks.port?.close(1000, 'bye');

    expect(socket.sent).toEqual(['frame']);
    expect(socket.closed).toEqual([[1000, 'bye']]);
    expect(typeof hooks.port?.bufferedAmount()).toBe('number');
  });
});
