/**
 * PAW Console Live Socket
 *
 * @fileoverview Only file in console that calls `new WebSocket`.
 *
 * Code above this writes against {@link SocketLike}, which exposes four
 * methods. Provider state machine — connect, authenticate, watch, degrade,
 * retry — unit-tested against a scripted fake socket, not against a browser
 * socket and real daemon.
 *
 * URL built from page own origin, scheme fixed to `wss:`. No config hook for
 * host, no fallback to `ws:`. Console is served by the daemon it connects to;
 * pointing the page at any other host connects to a daemon that did not serve
 * it, which the daemon origin gate rejects.
 *
 * @module @paw/gui/infrastructure/liveSocket
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { LIVE_SUBPROTOCOL } from '@paw/core';

/**
 * Path daemon serve live wire on.
 */
export const LIVE_PATH = '/live';

/**
 * Slice of `WebSocket` console use.
 *
 * @interface SocketLike
 * @property {(text: string) => void} send - Send one text frame.
 * @property {(code?: number, reason?: string) => void} close - Close the socket.
 * @property {(handlers: SocketHandlers) => void} listen - Register four callbacks.
 */
export interface SocketLike {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  listen(handlers: SocketHandlers): void;
}

/**
 * What console want to be told about socket.
 *
 * @interface SocketHandlers
 * @property {() => void} open - Socket connected.
 * @property {(raw: string) => void} message - Text frame arrived.
 * @property {(code: number) => void} close - Socket ended; code say why.
 * @property {() => void} error - Socket failed. Close always follow.
 */
export interface SocketHandlers {
  open(): void;
  message(raw: string): void;
  close(code: number): void;
  error(): void;
}

/**
 * Open sockets. Inject so provider can drive by fake.
 */
export type SocketFactory = () => SocketLike;

/**
 * Window fields URL derive from.
 *
 * @interface SocketWindow
 * @property {{ host: string; protocol: string }} location - Page own location.
 */
export interface SocketWindow {
  readonly location: { readonly host: string; readonly protocol: string };
}

/**
 * Live-wire URL for page, or null when page not served over TLS.
 *
 * Console opened from `file://` or served over plain `http:` gets null rather
 * than a `ws:` URL. A `ws:` connection sends the session credential in
 * cleartext readable by anything on the machine.
 *
 * @param {SocketWindow} win - Window to read location from.
 * @returns {string | null} `wss:` URL, or null when page not on https.
 */
export function liveUrl(win: SocketWindow): string | null {
  if (win.location.protocol !== 'https:' || win.location.host === '') {
    return null;
  }
  return `wss://${win.location.host}${LIVE_PATH}`;
}

/**
 * Browser API this module need, so constructor itself injectable in environment
 * with no `WebSocket` — or has one, and should not use it.
 *
 * @typedef {Function} WebSocketConstructor
 */
export type WebSocketConstructor = new (url: string, protocols?: string | string[]) => WebSocket;

/**
 * Build factory that open real socket.
 *
 * @param {string} url - `wss:` URL to open.
 * @param {WebSocketConstructor} ctor - `WebSocket` constructor.
 * @returns {SocketFactory} Factory.
 */
export function createSocketFactory(url: string, ctor: WebSocketConstructor): SocketFactory {
  return () => {
    const socket = new ctor(url, LIVE_SUBPROTOCOL);
    return {
      send: (text: string) => socket.send(text),
      close: (code?: number, reason?: string) => socket.close(code, reason),
      listen: (handlers: SocketHandlers) => {
        socket.onopen = () => handlers.open();
        socket.onmessage = (event: MessageEvent<unknown>) => handlers.message(String(event.data));
        socket.onclose = (event: CloseEvent) => handlers.close(event.code);
        socket.onerror = () => handlers.error();
      },
    };
  };
}
