/**
 * PAW Console Live Wire
 *
 * @fileoverview Console connection, as state machine.
 *
 * Single hook manages connect, authenticate, watch, degrade, retry;
 * used exactly once, by provider. Code below the hook reads console
 * state through existing hooks; it never detects whether state arrived
 * over socket or poll. The transport only exists at or below
 * `application/`, so the socket or poll implementation can be switched
 * without touching component code.
 *
 * States, each one a distinct mode tracked in state:
 *
 * - `static` — artifact page with no daemon. No recovery; nothing attempted.
 * - `connecting` — first socket opening. Never re-entered from `degraded`.
 * - `authenticating` — open, credential sent, waiting for first frame.
 * - `live` — receiving slices.
 * - `degraded` — socket down and console polls instead; a retry is
 *   scheduled underneath. Latched: retry attempts stay `degraded` until a
 *   `hello` frame proves the wire up. An attempt in flight is not a wire
 *   up, and publishing it flickers the banner and stops the poll on every
 *   retry tick.
 * - `locked-out` — daemon rejected the credential. Polling is refused
 *   too, so retry is pointless; operator must re-open the printed URL.
 *
 * Retry is exponential with **full jitter** — `random() * min(cap, base * 2^n)`
 * — because several consoles opened against one daemon otherwise reconnect
 * in lockstep after restart and all send on the socket the daemon just
 * reopened as it initializes.
 *
 * @module @paw/gui/application/hooks/useLiveWire
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  CLIENT_SILENCE_MS,
  CLOSE_AUTH,
  CLOSE_CAPACITY,
  CLOSE_SHUTDOWN,
  authFrame,
  encodeRelease,
  encodeScope,
  parseEnvelope,
  watchFrame,
  type LiveEnvelope,
  type PawSnapshot,
  type RunSettings,
} from '@paw/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SocketFactory, SocketLike } from '../../infrastructure/liveSocket.js';

/**
 * Where console connection be.
 *
 * @typedef {'static'|'connecting'|'authenticating'|'live'|'degraded'|'locked-out'} LiveMode
 */
export type LiveMode = 'static' | 'connecting' | 'authenticating' | 'live' | 'degraded' | 'locked-out';

/**
 * First retry delay, in milliseconds.
 */
export const RETRY_BASE_MS = 500;

/**
 * Longest a retry ever wait.
 */
export const RETRY_CAP_MS = 15_000;

/**
 * Delay before attempt `n`, with full jitter.
 *
 * @param {number} attempt - How many attempts already failed.
 * @param {number} random - Number in [0, 1).
 * @returns {number} Delay in milliseconds.
 */
export function retryDelay(attempt: number, random: number): number {
  return Math.floor(random * Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt));
}

/**
 * What the hook need to run wire.
 *
 * @interface LiveWireDeps
 * @property {SocketFactory | null} connect - Opens socket; null for static page.
 * @property {string | null} token - Adopted credential; null mean locked out before try.
 * @property {string | null} plan - Plan console look at.
 * @property {(event: LiveEnvelope) => void} onEvent - Sink for every frame.
 * @property {() => number} [now] - Milliseconds, for silence watchdog.
 * @property {() => number} [random] - Number in [0, 1), for retry jitter.
 */
export interface LiveWireDeps {
  readonly connect: SocketFactory | null;
  readonly token: string | null;
  readonly plan: string | null;
  onEvent(event: LiveEnvelope): void;
  now?(): number;
  random?(): number;
}

/**
 * What console show about its connection.
 *
 * @interface LiveWire
 * @property {LiveMode} mode - Where connection be.
 * @property {() => void} retryNow - Try again now, for banner button.
 * @property {(path: string) => void} scope - Grab repository, over live socket; no-op until one authenticated.
 * @property {(settings: RunSettings) => void} release - Ask daemon to release herd; operator approve in terminal. No-op until socket authenticated.
 */
export interface LiveWire {
  readonly mode: LiveMode;
  retryNow(): void;
  scope(path: string): void;
  release(settings: RunSettings): void;
}

/**
 * Run the console's connection.
 *
 * @param {LiveWireDeps} deps - What it need.
 * @returns {LiveWire} Mode, and way to retry.
 */
export function useLiveWire(deps: LiveWireDeps): LiveWire {
  const { connect, token, plan, onEvent } = deps;

  const [mode, setMode] = useState<LiveMode>('static');
  // Increments only to re-run the effect. Current backoff depth lives
  // in a ref, so recording a success does not itself re-run the effect,
  // which would tear down a socket that just succeeded. See `stepRef`.
  const [reconnect, setReconnect] = useState(0);
  const stepRef = useRef(0);
  const socketRef = useRef<SocketLike | null>(null);
  // Socket that authenticated. `socketRef` is whichever socket is open;
  // only this socket is writable.
  const liveSocketRef = useRef<SocketLike | null>(null);
  const watchedRef = useRef<string | null>(plan);

  // Every injected function is held in a ref, and the effect depends on
  // none of them. A caller that passes an inline factory would otherwise
  // re-run this effect on every render of its parent; each run closes a
  // socket and opens another — a reconnect loop driven by unrelated
  // re-renders, with no visible or logged signal.
  const eventRef = useRef(onEvent);
  eventRef.current = onEvent;
  const connectRef = useRef(connect);
  connectRef.current = connect;
  const nowRef = useRef(deps.now ?? Date.now);
  nowRef.current = deps.now ?? Date.now;
  const randomRef = useRef(deps.random ?? Math.random);
  randomRef.current = deps.random ?? Math.random;

  const connectable = connect !== null;

  const retryNow = useCallback(() => {
    // Re-runs the effect, which cancels any pending retry timer and closes
    // any open socket. While degraded there is no socket open, so closing
    // alone would do nothing; incrementing `reconnect` is what triggers the
    // reconnect.
    stepRef.current = 0;
    setReconnect((count) => count + 1);
  }, []);

  const scope = useCallback((path: string): void => {
    // Sent only over a socket that authenticated — the same guard the
    // watch effect uses — so this never becomes the first frame on a fresh
    // socket, which the daemon closes as talking-before-auth.
    if (socketRef.current === null || socketRef.current !== liveSocketRef.current) {
      return;
    }
    socketRef.current.send(encodeScope(path));
  }, []);

  const release = useCallback((settings: RunSettings): void => {
    // Same auth guard as scope: this never becomes the first frame on a fresh socket.
    if (socketRef.current === null || socketRef.current !== liveSocketRef.current) {
      return;
    }
    socketRef.current.send(encodeRelease(settings));
  }, []);

  useEffect(() => {
    const open = connectRef.current;
    if (!connectable || open === null) {
      setMode('static');
      return undefined;
    }
    if (token === null) {
      // No credential to present. Polling is refused for the same reason,
      // so this is a dead end the operator must fix, not a state to retry.
      setMode('locked-out');
      return undefined;
    }

    let live = true;
    let heard = nowRef.current();
    let retry: ReturnType<typeof setTimeout> | null = null;

    /**
     * Closes this socket and schedules another attempt. Called only from
     * the close handler, which already checks that this effect is still
     * the live one.
     *
     * The step is passed in because the close handler selects it:
     * shutdown retries from the top of backoff, capacity refusal goes one
     * step deeper. It is recorded in a ref, never in state, so reaching a
     * healthy connection resets it **without** re-running this effect.
     *
     * @param {number} step - Attempt number this delay for.
     */
    const degrade = (step: number): void => {
      stepRef.current = step + 1;
      setMode('degraded');
      retry = setTimeout(
        () => setReconnect((count) => count + 1),
        retryDelay(step, randomRef.current()),
      );
    };

    setMode((prev) => (prev === 'degraded' ? 'degraded' : 'connecting'));
    const socket = open();
    socketRef.current = socket;

    socket.listen({
      open: () => {
        if (!live) {
          return;
        }
        setMode((prev) => (prev === 'degraded' ? 'degraded' : 'authenticating'));
        socket.send(authFrame(token));
      },

      message: (raw: string) => {
        if (!live) {
          return;
        }
        heard = nowRef.current();
        const event = parseEnvelope(raw);
        if (event === null) {
          // Message is not valid in this protocol; something else is on the socket.
          socket.close();
          return;
        }
        if (event.topic === 'hello') {
          // This socket authenticated and is now writable. At startup the
          // daemon begins watching the plan it opened on, so the console's
          // own selection must be re-sent — the effect below compares
          // against `watchedRef`, which a reconnect clears.
          liveSocketRef.current = socket;
          watchedRef.current = (event.data as PawSnapshot).selectedPlan;
          setMode('live');
          // Stored in a ref. Resetting a piece of state the effect depends
          // on would re-run the effect and close the socket that just
          // authenticated; every reconnect would cost two sockets, two round
          // trips and two full snapshots, and re-render the console.
          stepRef.current = 0;
        }
        eventRef.current(event);
      },

      close: (code: number) => {
        if (!live) {
          return;
        }
        socketRef.current = null;
        liveSocketRef.current = null;
        if (code === CLOSE_AUTH) {
          setMode('locked-out');
          return;
        }
        if (code === CLOSE_SHUTDOWN) {
          // Daemon announced shutdown. Retry from the top of backoff
          // — it may restart, and sending immediately would only add to its load.
          degrade(0);
          return;
        }
        if (code === CLOSE_CAPACITY) {
          // Told to back off, so advance one step deeper. Depth resets on
          // every `hello`, so without this a rate-limited console would
          // reconnect in under half a second and get rate-limited again, in
          // a loop against the very condition the daemon asked it to relieve.
          degrade(stepRef.current + 1);
          return;
        }
        degrade(stepRef.current);
      },

      error: () => {
        // Close always follow an error; degrade here too would schedule
        // two retries for one failure.
      },
    });

    const watchdog = setInterval(() => {
      if (live && nowRef.current() - heard > CLIENT_SILENCE_MS) {
        // The host sends a slice every second. Several seconds without one
        // means the connection is dead with no close event to trigger a retry.
        socket.close();
      }
    }, CLIENT_SILENCE_MS);

    return () => {
      live = false;
      clearInterval(watchdog);
      if (retry !== null) {
        clearTimeout(retry);
      }
      socketRef.current = null;
      socket.close();
    };
  }, [connectable, token, reconnect]);

  useEffect(() => {
    // Guard on the socket this effect is *currently* holding, not merely on
    // `mode`. A reconnect swaps `socketRef` for a fresh, unauthenticated socket
    // while `mode` still 'live' for a render, and sending a `watch` as that
    // socket's first frame makes the daemon close it as talking-before-auth —
    // which the close handler below latches into the terminal locked-out state.
    // The console would brick itself on a reconnect that just succeeded.
    if (mode !== 'live' || socketRef.current === null || socketRef.current !== liveSocketRef.current) {
      return;
    }
    if (plan !== watchedRef.current) {
      watchedRef.current = plan;
      socketRef.current.send(watchFrame(plan));
    }
  }, [mode, plan]);

  return { mode, retryNow, scope, release };
}
