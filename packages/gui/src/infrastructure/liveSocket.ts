/**
 * PAW Console Live Socket
 *
 * @fileoverview The one file in the console that says `new WebSocket`.
 *
 * Everything above this is written against {@link SocketLike}, which is four
 * methods wide, so the provider's state machine — connect, authenticate, watch,
 * degrade, retry — is unit-tested against a scripted fake rather than against a
 * browser's socket and a real daemon. That is the difference between testing the
 * transitions and testing that a connection happened to work once.
 *
 * The URL is derived from the page's own origin, and only ever as `wss:`. There
 * is no configuration hook for the host and no fallback to `ws:`: the console is
 * served by the daemon it talks to, so anything else would be a page pointed at
 * a daemon it was not served by, which is precisely the situation the daemon's
 * origin gate exists to refuse.
 *
 * @module @paw/gui/infrastructure/liveSocket
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { LIVE_SUBPROTOCOL } from '@paw/core';

/**
 * The path the daemon serves the live wire on.
 */
export const LIVE_PATH = '/live';

/**
 * The slice of `WebSocket` the console uses.
 *
 * @interface SocketLike
 * @property {(text: string) => void} send - Send one text frame.
 * @property {(code?: number, reason?: string) => void} close - Close the socket.
 * @property {(handlers: SocketHandlers) => void} listen - Register the four callbacks.
 */
export interface SocketLike {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  listen(handlers: SocketHandlers): void;
}

/**
 * What the console wants to be told about a socket.
 *
 * @interface SocketHandlers
 * @property {() => void} open - The socket connected.
 * @property {(raw: string) => void} message - A text frame arrived.
 * @property {(code: number) => void} close - The socket ended; the code says why.
 * @property {() => void} error - The socket failed. A close always follows.
 */
export interface SocketHandlers {
  open(): void;
  message(raw: string): void;
  close(code: number): void;
  error(): void;
}

/**
 * Opens sockets. Injected so the provider can be driven by a fake.
 */
export type SocketFactory = () => SocketLike;

/**
 * The window fields the URL is derived from.
 *
 * @interface SocketWindow
 * @property {{ host: string; protocol: string }} location - The page's own location.
 */
export interface SocketWindow {
  readonly location: { readonly host: string; readonly protocol: string };
}

/**
 * The live-wire URL for a page, or null when the page was not served over TLS.
 *
 * A console opened from `file://` or served over plain `http:` gets null rather
 * than a `ws:` URL. Downgrading here would send the session's credential over a
 * connection anything on the machine can read, and "it works on http too" is how
 * that ends up shipping.
 *
 * @param {SocketWindow} win - The window to read the location from.
 * @returns {string | null} The `wss:` URL, or null when the page is not on https.
 */
export function liveUrl(win: SocketWindow): string | null {
  if (win.location.protocol !== 'https:' || win.location.host === '') {
    return null;
  }
  return `wss://${win.location.host}${LIVE_PATH}`;
}

/**
 * The browser API this module needs, so the constructor itself is injectable in
 * an environment that has no `WebSocket` — or has one, and should not be used.
 *
 * @typedef {Function} WebSocketConstructor
 */
export type WebSocketConstructor = new (url: string, protocols?: string | string[]) => WebSocket;

/**
 * Build a factory that opens the real socket.
 *
 * @param {string} url - The `wss:` URL to open.
 * @param {WebSocketConstructor} ctor - The `WebSocket` constructor.
 * @returns {SocketFactory} The factory.
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
