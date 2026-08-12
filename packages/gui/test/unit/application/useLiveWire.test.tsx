/**
 * Tests for Live Wire state machine.
 *
 * @fileoverview Drive every transition against scripted fake socket.
 * `liveSocket.ts` abstracts the socket so tests control connection outcomes; a
 * real `WebSocket` makes tests depend on whether connection happens to succeed.
 *
 * Transition named `locked-out`. Daemon that refuses a credential refuses
 * polling requests for the same reason, so retry is pointless; console stops
 * and reports it. Getting this wrong produces an endless reconnect loop against
 * a daemon that never accepts it, or a spinner that spins forever.
 *
 * @module @paw/gui/test/unit/application/useLiveWire
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  CLIENT_SILENCE_MS,
  CLOSE_AUTH,
  CLOSE_CAPACITY,
  CLOSE_MALFORMED,
  CLOSE_SHUTDOWN,
  encodeEnvelope,
  parseClientMessage,
  type LiveEnvelope,
} from '@paw/core';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RETRY_BASE_MS,
  RETRY_CAP_MS,
  retryDelay,
  useLiveWire,
} from '../../../src/application/hooks/useLiveWire.js';
import type { SocketHandlers, SocketLike } from '../../../src/infrastructure/liveSocket.js';
import { makeSnapshot } from '../../fixtures.js';

const TOKEN = 'a-printed-credential';

/**
 * Socket test drive by hand.
 *
 * @returns {object} Socket and controls to drive it.
 */
const scripted = (): {
  socket: SocketLike;
  sent: string[];
  closes: number;
  open(): void;
  deliver(raw: string): void;
  end(code: number): void;
  fail(): void;
} => {
  const state = { sent: [] as string[], closes: 0, handlers: null as SocketHandlers | null };
  return {
    get sent() {
      return state.sent;
    },
    get closes() {
      return state.closes;
    },
    socket: {
      send: (text: string) => state.sent.push(text),
      close: () => {
        state.closes += 1;
      },
      listen: (handlers: SocketHandlers) => {
        state.handlers = handlers;
      },
    },
    open: () => act(() => state.handlers?.open()),
    deliver: (raw: string) => act(() => state.handlers?.message(raw)),
    end: (code: number) => act(() => state.handlers?.close(code)),
    fail: () => act(() => state.handlers?.error()),
  } as never;
};

/**
 * `hello` frame carry snapshot.
 *
 * @returns {string} Frame.
 */
const hello = (): string => encodeEnvelope('hello', makeSnapshot(), 1);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('retryDelay', () => {
  it('backs off exponentially and stops at the cap', () => {
    expect(retryDelay(0, 0.999)).toBeLessThan(RETRY_BASE_MS);
    expect(retryDelay(1, 0.999)).toBeLessThan(RETRY_BASE_MS * 2);
    expect(retryDelay(99, 0.999)).toBeLessThan(RETRY_CAP_MS);
  });

  it('applies full jitter, so consoles do not reconnect in lockstep', () => {
    // Without jitter, several restarted consoles reconnect at the exact
    // moment the daemon comes back up.
    expect(retryDelay(5, 0)).toBe(0);
    expect(retryDelay(5, 0.5)).toBeLessThan(retryDelay(5, 0.9));
  });
});

describe('the live wire', () => {
  it('is static, and attempts nothing, with no daemon behind the page', () => {
    const { result } = renderHook(() =>
      useLiveWire({ connect: null, token: null, plan: null, onEvent: () => undefined }),
    );
    expect(result.current.mode).toBe('static');
  });

  it('is locked out before it starts when the tab adopted no credential', () => {
    const socket = scripted();
    const connect = vi.fn(() => socket.socket);
    const { result } = renderHook(() =>
      useLiveWire({ connect, token: null, plan: null, onEvent: () => undefined }),
    );

    // Opening a socket we cannot authenticate costs one of daemon's four
    // pre-auth slots and ends in 4401 either way.
    expect(result.current.mode).toBe('locked-out');
    expect(connect).not.toHaveBeenCalled();
  });

  it('connects, authenticates, and goes live on the first hello', () => {
    const socket = scripted();
    const events: LiveEnvelope[] = [];
    const { result } = renderHook(() =>
      useLiveWire({
        connect: () => socket.socket,
        token: TOKEN,
        plan: null,
        onEvent: (event) => events.push(event),
      }),
    );

    expect(result.current.mode).toBe('connecting');

    socket.open();
    expect(result.current.mode).toBe('authenticating');
    expect(parseClientMessage(socket.sent[0])).toEqual({ v: 1, type: 'auth', token: TOKEN });

    socket.deliver(hello());
    expect(result.current.mode).toBe('live');
    expect(events).toHaveLength(1);
    expect(events[0].topic).toBe('hello');
  });

  it('grabs a repository over the authenticated socket', () => {
    const socket = scripted();
    const { result } = renderHook(() =>
      useLiveWire({ connect: () => socket.socket, token: TOKEN, plan: null, onEvent: () => undefined }),
    );
    socket.open();
    socket.deliver(hello());

    act(() => result.current.scope('/work/other'));
    expect(parseClientMessage(socket.sent[socket.sent.length - 1])).toEqual({
      v: 1,
      type: 'scope',
      path: '/work/other',
    });
  });

  it('does not grab until a socket has authenticated', () => {
    const socket = scripted();
    const { result } = renderHook(() =>
      useLiveWire({ connect: () => socket.socket, token: TOKEN, plan: null, onEvent: () => undefined }),
    );
    socket.open();

    act(() => result.current.scope('/work/other'));
    expect(socket.sent).toHaveLength(1);
  });

  it('does not grab with no daemon behind the page', () => {
    const { result } = renderHook(() =>
      useLiveWire({ connect: null, token: null, plan: null, onEvent: () => undefined }),
    );
    act(() => result.current.scope('/work/other'));
    expect(result.current.mode).toBe('static');
  });

  it('asks a release over the authenticated socket', () => {
    const socket = scripted();
    const { result } = renderHook(() =>
      useLiveWire({ connect: () => socket.socket, token: TOKEN, plan: null, onEvent: () => undefined }),
    );
    socket.open();
    socket.deliver(hello());

    act(() => result.current.release({ plan: 'plans/demo.swarm.mjs', live: false }));
    expect(parseClientMessage(socket.sent[socket.sent.length - 1])).toEqual({
      v: 1,
      type: 'release',
      settings: { plan: 'plans/demo.swarm.mjs', live: false },
    });
  });

  it('does not ask a release until a socket has authenticated', () => {
    const socket = scripted();
    const { result } = renderHook(() =>
      useLiveWire({ connect: () => socket.socket, token: TOKEN, plan: null, onEvent: () => undefined }),
    );
    socket.open();

    act(() => result.current.release({ plan: 'plans/demo.swarm.mjs', live: false }));
    expect(socket.sent).toHaveLength(1);
  });

  it('hands every frame to the console once it is live', () => {
    const socket = scripted();
    const events: LiveEnvelope[] = [];
    renderHook(() =>
      useLiveWire({
        connect: () => socket.socket,
        token: TOKEN,
        plan: null,
        onEvent: (event) => events.push(event),
      }),
    );
    socket.open();
    socket.deliver(hello());

    socket.deliver(encodeEnvelope('processes', [], 2));
    socket.deliver(encodeEnvelope('host', makeSnapshot().host, 3));

    expect(events.map((event) => event.topic)).toEqual(['hello', 'processes', 'host']);
  });

  it('closes a socket that speaks something other than this protocol', () => {
    const socket = scripted();
    const events: LiveEnvelope[] = [];
    renderHook(() =>
      useLiveWire({
        connect: () => socket.socket,
        token: TOKEN,
        plan: null,
        onEvent: (event) => events.push(event),
      }),
    );
    socket.open();

    socket.deliver('{"hello":"there"}');

    expect(events).toEqual([]);
    expect(socket.closes).toBeGreaterThan(0);
  });

  it('locks out on a refused credential and stops trying', () => {
    const socket = scripted();
    const connect = vi.fn(() => socket.socket);
    const { result } = renderHook(() =>
      useLiveWire({ connect, token: TOKEN, plan: null, onEvent: () => undefined }),
    );
    socket.open();

    socket.end(CLOSE_AUTH);

    expect(result.current.mode).toBe('locked-out');
    act(() => {
      vi.advanceTimersByTime(RETRY_CAP_MS * 4);
    });
    // One attempt, no more. Polling refused for same reason.
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('degrades and retries on any other close', () => {
    const socket = scripted();
    const connect = vi.fn(() => socket.socket);
    const { result } = renderHook(() =>
      useLiveWire({
        connect,
        token: TOKEN,
        plan: null,
        onEvent: () => undefined,
        random: () => 0.5,
      }),
    );
    socket.open();
    socket.deliver(hello());

    socket.end(CLOSE_MALFORMED);
    expect(result.current.mode).toBe('degraded');

    act(() => {
      vi.advanceTimersByTime(RETRY_CAP_MS);
    });
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('stays degraded through a retry attempt until a hello proves the wire up', () => {
    const socket = scripted();
    const connect = vi.fn(() => socket.socket);
    const { result } = renderHook(() =>
      useLiveWire({
        connect,
        token: TOKEN,
        plan: null,
        onEvent: () => undefined,
        random: () => 0.5,
      }),
    );
    socket.open();
    socket.deliver(hello());
    socket.end(1006);
    expect(result.current.mode).toBe('degraded');

    act(() => {
      vi.advanceTimersByTime(RETRY_CAP_MS);
    });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(result.current.mode).toBe('degraded');

    socket.open();
    expect(result.current.mode).toBe('degraded');

    socket.deliver(hello());
    expect(result.current.mode).toBe('live');
  });

  it('retries from the top of the backoff when the daemon says it is shutting down', () => {
    const socket = scripted();
    const delays: number[] = [];
    const connect = vi.fn(() => socket.socket);
    renderHook(() =>
      useLiveWire({
        connect,
        token: TOKEN,
        plan: null,
        onEvent: () => undefined,
        random: () => {
          delays.push(delays.length);
          return 0.999;
        },
      }),
    );
    socket.open();
    socket.deliver(hello());

    socket.end(CLOSE_SHUTDOWN);
    act(() => {
      vi.advanceTimersByTime(RETRY_BASE_MS);
    });

    // Daemon restarts and comes back, but reconnecting from deep backoff
    // means the console reconnects long after the daemon is ready.
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('does not schedule two retries for one failure', () => {
    const socket = scripted();
    const connect = vi.fn(() => socket.socket);
    renderHook(() =>
      useLiveWire({ connect, token: TOKEN, plan: null, onEvent: () => undefined, random: () => 0 }),
    );
    socket.open();

    // Socket error always followed by close. Act on both open two
    // sockets for one failure, double daemon connection rate.
    socket.fail();
    socket.end(1006);
    act(() => {
      vi.advanceTimersByTime(RETRY_CAP_MS);
    });

    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('does not tear down the socket that just succeeded', () => {
    const socket = scripted();
    const connect = vi.fn(() => socket.socket);
    const { result } = renderHook(() =>
      useLiveWire({ connect, token: TOKEN, plan: null, onEvent: () => undefined, random: () => 0 }),
    );

    // One failure, successful reconnect coming.
    socket.open();
    socket.end(1006);
    act(() => {
      vi.advanceTimersByTime(RETRY_CAP_MS);
    });
    expect(connect).toHaveBeenCalledTimes(2);

    socket.open();
    socket.deliver(hello());

    // Recording success no re-run connection effect. If did,
    // every reconnect cost two sockets, two auth round trips and two full
    // snapshots, console flicker live -> connecting -> live.
    expect(result.current.mode).toBe('live');
    expect(connect).toHaveBeenCalledTimes(2);
    act(() => {
      vi.advanceTimersByTime(RETRY_CAP_MS * 2);
    });
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('reconnects when asked even though there is no socket to close', () => {
    const socket = scripted();
    const connect = vi.fn(() => socket.socket);
    const { result } = renderHook(() =>
      useLiveWire({ connect, token: TOKEN, plan: null, onEvent: () => undefined, random: () => 0.9 }),
    );
    socket.open();
    socket.deliver(hello());
    socket.end(CLOSE_CAPACITY);
    expect(result.current.mode).toBe('degraded');

    // Degraded state means the socket is already gone, so closing it does
    // nothing; the button initiates the reconnect.
    act(() => result.current.retryNow());

    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('reconnects at once when the operator asks', () => {
    const socket = scripted();
    const connect = vi.fn(() => socket.socket);
    const { result } = renderHook(() =>
      useLiveWire({ connect, token: TOKEN, plan: null, onEvent: () => undefined, random: () => 0 }),
    );
    socket.open();
    socket.deliver(hello());

    act(() => result.current.retryNow());

    expect(socket.closes).toBeGreaterThan(0);
  });

  it('gives up on a socket that has gone silent, without waiting for a close', () => {
    const socket = scripted();
    let clock = 0;
    renderHook(() =>
      useLiveWire({
        connect: () => socket.socket,
        token: TOKEN,
        plan: null,
        onEvent: () => undefined,
        now: () => clock,
      }),
    );
    socket.open();
    socket.deliver(hello());

    // Host slice ticks every second. A wire silent for several ticks is
    // treated as dead even though no close event reports it.
    clock = CLIENT_SILENCE_MS + 1;
    act(() => {
      vi.advanceTimersByTime(CLIENT_SILENCE_MS);
    });

    expect(socket.closes).toBeGreaterThan(0);
  });

  it('keeps a socket that is still talking', () => {
    const socket = scripted();
    let clock = 0;
    renderHook(() =>
      useLiveWire({
        connect: () => socket.socket,
        token: TOKEN,
        plan: null,
        onEvent: () => undefined,
        now: () => clock,
      }),
    );
    socket.open();
    socket.deliver(hello());

    clock = CLIENT_SILENCE_MS;
    socket.deliver(encodeEnvelope('host', makeSnapshot().host, 2));
    act(() => {
      vi.advanceTimersByTime(CLIENT_SILENCE_MS);
    });

    expect(socket.closes).toBe(0);
  });

  it('switches plans over the open socket rather than reconnecting', () => {
    const socket = scripted();
    const connect = vi.fn(() => socket.socket);
    const { rerender } = renderHook(
      ({ plan }: { plan: string | null }) =>
        useLiveWire({ connect, token: TOKEN, plan, onEvent: () => undefined }),
      // Fixture snapshot already on this plan, console and
      // daemon agree on connect, no corrective watch send.
      { initialProps: { plan: 'plans/demo.swarm.mjs' as string | null } },
    );
    socket.open();
    socket.deliver(hello());
    expect(socket.sent).toHaveLength(1);

    rerender({ plan: 'plans/lore.swarm.mjs' });

    expect(parseClientMessage(socket.sent[1])).toEqual({
      v: 1,
      type: 'watch',
      plan: 'plans/lore.swarm.mjs',
    });
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('re-asserts its own selection when the daemon opened on a different plan', () => {
    const socket = scripted();
    renderHook(() =>
      useLiveWire({
        connect: () => socket.socket,
        token: TOKEN,
        plan: 'plans/lore.swarm.mjs',
        onEvent: () => undefined,
      }),
    );
    socket.open();

    // A reconnected session starts on whichever plan the daemon opened on;
    // the console must re-assert the plan it actually selects. Without this
    // it renders other plans' briefs and reports itself live.
    socket.deliver(hello());

    expect(parseClientMessage(socket.sent[1])).toEqual({
      v: 1,
      type: 'watch',
      plan: 'plans/lore.swarm.mjs',
    });
  });

  it('never sends on a socket that has not authenticated', () => {
    const socket = scripted();
    const { rerender } = renderHook(
      ({ plan }: { plan: string | null }) =>
        useLiveWire({ connect: () => socket.socket, token: TOKEN, plan, onEvent: () => undefined }),
      { initialProps: { plan: 'plans/demo.swarm.mjs' as string | null } },
    );
    socket.open();
    socket.deliver(hello());
    const afterHello = socket.sent.length;

    // Socket dropped while a fresh one is opening. Sending `watch` as the
    // first frame before authenticating makes the daemon close the socket,
    // and the console breaks on a reconnect that just succeeded.
    socket.end(1006);
    rerender({ plan: 'plans/other.swarm.mjs' });

    expect(socket.sent).toHaveLength(afterHello);
  });

  it('backs off when the daemon says it is at capacity', () => {
    const socket = scripted();
    const connect = vi.fn(() => socket.socket);
    renderHook(() =>
      useLiveWire({ connect, token: TOKEN, plan: null, onEvent: () => undefined, random: () => 0.9 }),
    );
    socket.open();
    socket.deliver(hello());

    socket.end(CLOSE_CAPACITY);
    act(() => {
      vi.advanceTimersByTime(RETRY_BASE_MS);
    });

    // Every other close resets the attempt counter on the preceding hello,
    // so without the 4429 branch a rate-limited console reconnects under
    // half a second and gets rate-limited again — a loop against the exact
    // capacity condition the daemon signals.
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('says nothing about a plan change while it is not live', () => {
    const socket = scripted();
    const { rerender } = renderHook(
      ({ plan }: { plan: string | null }) =>
        useLiveWire({ connect: () => socket.socket, token: TOKEN, plan, onEvent: () => undefined }),
      { initialProps: { plan: null as string | null } },
    );

    rerender({ plan: 'plans/lore.swarm.mjs' });

    expect(socket.sent).toEqual([]);
  });

  it('closes its socket and drops its timers when the console unmounts', () => {
    const socket = scripted();
    const { unmount } = renderHook(() =>
      useLiveWire({
        connect: () => socket.socket,
        token: TOKEN,
        plan: null,
        onEvent: () => undefined,
      }),
    );
    socket.open();
    socket.deliver(hello());

    unmount();

    expect(socket.closes).toBeGreaterThan(0);
    // Nothing after unmount. Delivering a frame to an unmounted hook would
    // update state on an unmounted component; a surviving timer would
    // reconnect forever.
    expect(() => socket.deliver(hello())).not.toThrow();
    expect(() => socket.end(1006)).not.toThrow();
  });

  it('does not present the credential on a socket that opened after unmount', () => {
    const socket = scripted();
    const { unmount } = renderHook(() =>
      useLiveWire({
        connect: () => socket.socket,
        token: TOKEN,
        plan: null,
        onEvent: () => undefined,
      }),
    );

    unmount();
    socket.open();

    // Socket completes its handshake after the console is gone; sending the
    // token to it gives a credential to a connection nobody holds.
    expect(socket.sent).toEqual([]);
  });
});
