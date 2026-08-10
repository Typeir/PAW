/**
 * PAW Console Live Wire
 *
 * @fileoverview The console's connection, as a state machine.
 *
 * One hook owns the whole thing — connect, authenticate, watch, degrade, retry —
 * and it is used exactly once, by the provider. Everything below reads console
 * state through the existing hooks and never learns whether that state arrived
 * over a socket or a poll. That is the point of putting it here: the transport is
 * invisible above `application/`, so switching it never touches a component.
 *
 * The states, and why each exists as a state rather than a flag:
 *
 * - `static` — an artifact page with no daemon. Terminal; nothing is attempted.
 * - `connecting` — a socket is opening.
 * - `authenticating` — open, credential sent, waiting for the first frame.
 * - `live` — receiving slices.
 * - `degraded` — the socket is down and the console is polling instead. Still
 *   correct, visibly slower, and retrying underneath.
 * - `locked-out` — the daemon refused the credential. Polling would be refused
 *   too, so retrying is pointless; the operator has to re-open the printed URL.
 *   A spinner here would be a lie, and an endless reconnect loop would be worse.
 *
 * Retry is exponential with **full jitter** — `random() * min(cap, base * 2^n)`
 * — because several consoles open against one daemon would otherwise reconnect
 * in lockstep after a restart and arrive as a thundering herd on the socket the
 * daemon just re-opened.
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
  encodeScope,
  parseEnvelope,
  watchFrame,
  type LiveEnvelope,
  type PawSnapshot,
} from '@paw/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SocketFactory, SocketLike } from '../../infrastructure/liveSocket.js';

/**
 * Where the console's connection is.
 *
 * @typedef {'static'|'connecting'|'authenticating'|'live'|'degraded'|'locked-out'} LiveMode
 */
export type LiveMode = 'static' | 'connecting' | 'authenticating' | 'live' | 'degraded' | 'locked-out';

/**
 * The first retry delay, in milliseconds.
 */
export const RETRY_BASE_MS = 500;

/**
 * The longest a retry will ever wait.
 */
export const RETRY_CAP_MS = 15_000;

/**
 * The delay before attempt `n`, with full jitter.
 *
 * @param {number} attempt - How many attempts have already failed.
 * @param {number} random - A number in [0, 1).
 * @returns {number} The delay in milliseconds.
 */
export function retryDelay(attempt: number, random: number): number {
  return Math.floor(random * Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt));
}

/**
 * What the hook needs to run the wire.
 *
 * @interface LiveWireDeps
 * @property {SocketFactory | null} connect - Opens a socket; null for a static page.
 * @property {string | null} token - The adopted credential; null means locked out before trying.
 * @property {string | null} plan - The plan the console is looking at.
 * @property {(event: LiveEnvelope) => void} onEvent - Sink for every frame.
 * @property {() => number} [now] - Milliseconds, for the silence watchdog.
 * @property {() => number} [random] - A number in [0, 1), for retry jitter.
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
 * What the console shows about its connection.
 *
 * @interface LiveWire
 * @property {LiveMode} mode - Where the connection is.
 * @property {() => void} retryNow - Try again immediately, for the banner's button.
 * @property {(path: string) => void} scope - Grab a repository, over the live socket; a no-op until one is authenticated.
 */
export interface LiveWire {
  readonly mode: LiveMode;
  retryNow(): void;
  scope(path: string): void;
}

/**
 * Run the console's connection.
 *
 * @param {LiveWireDeps} deps - What it needs.
 * @returns {LiveWire} The mode, and a way to retry.
 */
export function useLiveWire(deps: LiveWireDeps): LiveWire {
  const { connect, token, plan, onEvent } = deps;

  const [mode, setMode] = useState<LiveMode>('static');
  // A trigger, not a measurement: it only ever increments, and its only job is
  // to re-run the effect. How deep the back-off currently is lives in a ref, so
  // that recording a success does not itself re-run the effect — which would
  // tear down the socket that had just succeeded. See `stepRef`.
  const [reconnect, setReconnect] = useState(0);
  const stepRef = useRef(0);
  const socketRef = useRef<SocketLike | null>(null);
  // The socket that has actually authenticated. `socketRef` is whatever is open;
  // this is what may be spoken to.
  const liveSocketRef = useRef<SocketLike | null>(null);
  const watchedRef = useRef<string | null>(plan);

  // Every injected function is held in a ref and the effect depends on none of
  // them. A caller that passes an inline factory — which is the normal thing to
  // write — would otherwise re-run this effect on every render of its parent,
  // and each run closes a socket and opens another. That is a reconnect loop
  // driven by unrelated re-renders, and it is silent.
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
    // Always re-runs the effect, which cancels any pending retry timer and
    // closes any socket on the way out. Closing the socket alone would do
    // nothing while degraded, because there is no socket to close.
    stepRef.current = 0;
    setReconnect((count) => count + 1);
  }, []);

  const scope = useCallback((path: string): void => {
    // Sent only over the socket that has authenticated — the guard the watch
    // effect uses — so a grab is never the first frame on a fresh socket the
    // daemon would close as talking-before-auth.
    if (socketRef.current === null || socketRef.current !== liveSocketRef.current) {
      return;
    }
    socketRef.current.send(encodeScope(path));
  }, []);

  useEffect(() => {
    const open = connectRef.current;
    if (!connectable || open === null) {
      setMode('static');
      return undefined;
    }
    if (token === null) {
      // Nothing to present. Polling would be refused for the same reason, so
      // this is a dead end the operator has to fix, not a state to spin in.
      setMode('locked-out');
      return undefined;
    }

    let live = true;
    let heard = nowRef.current();
    let retry: ReturnType<typeof setTimeout> | null = null;

    /**
     * Give up on this socket and schedule another attempt. Reached only from the
     * close handler, which has already checked that this effect is still the
     * live one.
     *
     * The step is passed in rather than inferred, because the close handler
     * needs to move it: a shutdown retries from the top, a capacity refusal one
     * step deeper. It is recorded in a ref rather than in state so that reaching
     * a healthy connection can reset it **without** re-running this effect.
     *
     * @param {number} step - The attempt number this delay is for.
     */
    const degrade = (step: number): void => {
      stepRef.current = step + 1;
      setMode('degraded');
      retry = setTimeout(
        () => setReconnect((count) => count + 1),
        retryDelay(step, randomRef.current()),
      );
    };

    setMode('connecting');
    const socket = open();
    socketRef.current = socket;

    socket.listen({
      open: () => {
        if (!live) {
          return;
        }
        setMode('authenticating');
        socket.send(authFrame(token));
      },

      message: (raw: string) => {
        if (!live) {
          return;
        }
        heard = nowRef.current();
        const event = parseEnvelope(raw);
        if (event === null) {
          // The daemon speaks this protocol; something else is on the socket.
          socket.close();
          return;
        }
        if (event.topic === 'hello') {
          // This socket has proved itself and may now be spoken to. A fresh
          // session on the daemon starts watching whatever the daemon opened
          // on, so the console's own selection has to be re-sent — the effect
          // below compares against `watchedRef`, which the reconnect clears.
          liveSocketRef.current = socket;
          watchedRef.current = (event.data as PawSnapshot).selectedPlan;
          setMode('live');
          // A ref, deliberately. Resetting a piece of state the effect depends
          // on would re-run the effect and close the socket that had just
          // authenticated — every reconnect would cost two sockets, two round
          // trips and two full snapshots, and the console would flicker.
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
          // The daemon said it is going away. Retry from the top of the backoff
          // — it may be restarting, and hammering will not help.
          degrade(0);
          return;
        }
        if (code === CLOSE_CAPACITY) {
          // Told to back off, so go one step deeper rather than level. The depth
          // is reset on every `hello`, so without this a rate-limited console
          // reconnects in under half a second and is rate limited again — a hot
          // loop against the very condition the daemon asked it to relieve.
          degrade(stepRef.current + 1);
          return;
        }
        degrade(stepRef.current);
      },

      error: () => {
        // A close always follows an error; degrading here as well would schedule
        // two retries for one failure.
      },
    });

    const watchdog = setInterval(() => {
      if (live && nowRef.current() - heard > CLIENT_SILENCE_MS) {
        // The host slice ticks every second. Silence for several ticks means the
        // wire is dead in a way no close event is going to tell us about.
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
    // Guarded on the socket the machine is *currently* holding, not merely on
    // `mode`. A reconnect swaps `socketRef` for a fresh, unauthenticated socket
    // while `mode` is still 'live' for a render, and sending a `watch` as that
    // socket's first frame makes the daemon close it as talking-before-auth —
    // which the close handler below latches into a terminal locked-out state.
    // The console would brick itself on a reconnect that had just succeeded.
    if (mode !== 'live' || socketRef.current === null || socketRef.current !== liveSocketRef.current) {
      return;
    }
    if (plan !== watchedRef.current) {
      watchedRef.current = plan;
      socketRef.current.send(watchFrame(plan));
    }
  }, [mode, plan]);

  return { mode, retryNow, scope };
}
