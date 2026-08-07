/**
 * Live Socket Tests
 *
 * @fileoverview The URL rule and the adapter's four callbacks.
 *
 * The URL rule is the security-relevant half: this module will build a `wss:`
 * URL or none at all. A `ws:` fallback would carry the session's credential over
 * a connection anything on the machine can read, and the way that ships is as a
 * convenience for "it should also work on http".
 *
 * @module @paw/gui/test/unit/infrastructure/liveSocket
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { LIVE_SUBPROTOCOL } from '@paw/core';
import { describe, expect, it, vi } from 'vitest';
import {
  LIVE_PATH,
  createSocketFactory,
  liveUrl,
  type SocketHandlers,
  type WebSocketConstructor,
} from '../../../src/infrastructure/liveSocket.js';

describe('liveUrl', () => {
  it('derives wss from the page that was served over https', () => {
    expect(liveUrl({ location: { host: '127.0.0.1:8971', protocol: 'https:' } })).toBe(
      `wss://127.0.0.1:8971${LIVE_PATH}`,
    );
    expect(liveUrl({ location: { host: 'localhost:8971', protocol: 'https:' } })).toBe(
      `wss://localhost:8971${LIVE_PATH}`,
    );
  });

  it('refuses to build a URL for a page that is not on https', () => {
    // No ws: fallback exists, at any scheme, for any reason. The console polls
    // instead — slower, and it never puts the credential on a readable wire.
    expect(liveUrl({ location: { host: '127.0.0.1:8971', protocol: 'http:' } })).toBeNull();
    expect(liveUrl({ location: { host: '', protocol: 'file:' } })).toBeNull();
    expect(liveUrl({ location: { host: 'x', protocol: 'file:' } })).toBeNull();
    expect(liveUrl({ location: { host: '', protocol: 'https:' } })).toBeNull();
  });
});

describe('createSocketFactory', () => {
  /**
   * A constructor that records what it was asked to open.
   *
   * @returns {object} The constructor and the socket it made.
   */
  const spyCtor = (): {
    ctor: WebSocketConstructor;
    urls: string[];
    protocols: Array<string | string[] | undefined>;
    socket: Record<string, unknown>;
  } => {
    const state = {
      urls: [] as string[],
      protocols: [] as Array<string | string[] | undefined>,
      socket: {} as Record<string, unknown>,
    };
    const ctor = function (this: unknown, url: string, protocols?: string | string[]) {
      state.urls.push(url);
      state.protocols.push(protocols);
      Object.assign(state.socket, {
        send: vi.fn(),
        close: vi.fn(),
      });
      return state.socket;
    } as unknown as WebSocketConstructor;
    return { ...state, ctor, get socket() {
      return state.socket;
    }, get urls() {
      return state.urls;
    }, get protocols() {
      return state.protocols;
    } } as never;
  };

  it('opens the URL it was built for, offering the versioned subprotocol', () => {
    const spy = spyCtor();
    createSocketFactory('wss://127.0.0.1:8971/live', spy.ctor)();

    expect(spy.urls).toEqual(['wss://127.0.0.1:8971/live']);
    expect(spy.protocols).toEqual([LIVE_SUBPROTOCOL]);
  });

  it('forwards send and close to the socket', () => {
    const spy = spyCtor();
    const socket = createSocketFactory('wss://x/live', spy.ctor)();

    socket.send('frame');
    socket.close(1000, 'bye');

    expect(spy.socket.send).toHaveBeenCalledWith('frame');
    expect(spy.socket.close).toHaveBeenCalledWith(1000, 'bye');
  });

  it('routes the four browser events to the four handlers', () => {
    const spy = spyCtor();
    const socket = createSocketFactory('wss://x/live', spy.ctor)();
    const seen: string[] = [];
    const handlers: SocketHandlers = {
      open: () => seen.push('open'),
      message: (raw) => seen.push(`message:${raw}`),
      close: (code) => seen.push(`close:${code}`),
      error: () => seen.push('error'),
    };

    socket.listen(handlers);
    (spy.socket.onopen as () => void)();
    (spy.socket.onmessage as (event: { data: unknown }) => void)({ data: '{"v":1}' });
    (spy.socket.onerror as () => void)();
    (spy.socket.onclose as (event: { code: number }) => void)({ code: 4401 });

    expect(seen).toEqual(['open', 'message:{"v":1}', 'error', 'close:4401']);
  });

  it('stringifies whatever the browser calls data, rather than trusting it', () => {
    const spy = spyCtor();
    const socket = createSocketFactory('wss://x/live', spy.ctor)();
    const frames: string[] = [];
    socket.listen({
      open: () => undefined,
      message: (raw) => frames.push(raw),
      close: () => undefined,
      error: () => undefined,
    });

    (spy.socket.onmessage as (event: { data: unknown }) => void)({ data: 42 });

    expect(frames).toEqual(['42']);
  });
});
