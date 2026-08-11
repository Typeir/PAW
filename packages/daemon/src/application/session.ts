/**
 * PAW Live Session
 *
 * @fileoverview One authenticated WebSocket be state machine. Socket I/O live
 * in `infrastructure`; decision logic live here, interacting with the socket
 * only through {@link WsSessionPort}.
 *
 * Rules: nothing go out before first frame authenticate — no hello, no error
 * body, no topic name. Credential compare in constant time over SHA-256
 * digests. Failed authentication be counted and reported, never turn into
 * lockout. Client that stop reading get dropped: events skip past threshold,
 * and it get fresh hello when buffer drain. No replay buffer.
 *
 * @module @paw/daemon/application/session
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  AUTH_TIMEOUT_MS,
  BACKPRESSURE_CLOSE_BYTES,
  BACKPRESSURE_RESUME_BYTES,
  BACKPRESSURE_SKIP_BYTES,
  BACKPRESSURE_STALE_MS,
  CLOSE_AUTH,
  CLOSE_BACKPRESSURE,
  CLOSE_CAPACITY,
  CLOSE_MALFORMED,
  MAX_MESSAGES_PER_WINDOW,
  MESSAGE_WINDOW_MS,
  encodeEnvelope,
  parseClientMessage,
  type LiveTopic,
  type LiveTopicMap,
  type PawSnapshot,
  type PlanSlice,
} from '@paw/core';
import { verifyToken } from '../infrastructure/security.js';
import type {
  LiveSession,
  SessionDeps,
  SessionState,
  SessionWatcher,
  WsSessionPort,
} from '../domain/session.js';
import { dispatchAttach, dispatchRelease, dispatchScope } from './sessionRouter.js';

/**
 * Build one live session over socket.
 *
 * @param {WsSessionPort} port - The socket.
 * @param {SessionDeps} deps - What daemon supply.
 * @param {SessionWatcher} watcher - Receives auth and close callbacks, used for registry count.
 * @param {string | null} openedOn - The plan it start watch, if any.
 * @returns {LiveSession} The session machine.
 */
export function createSession(
  port: WsSessionPort,
  deps: SessionDeps,
  watcher: SessionWatcher,
  openedOn: string | null,
): LiveSession {
  let state: SessionState = 'pre-auth';
  let watched: string | null = openedOn;
  let stale = false;
  let staleSince = 0;
  // One snapshot in flight at a time; `pending` records another was requested
  // while one builds.
  let sending = false;
  let pending = false;
  let windowStartedAt = deps.clock();
  let messagesInWindow = 0;
  const openedAt = deps.clock();

  /**
   * Close and stop, once. All other paths out of the session call this.
   *
   * @param {number} code - The close code.
   * @param {string} reason - The close reason.
   */
  const shut = (code: number, reason: string): void => {
    if (state === 'closed') {
      return;
    }
    state = 'closed';
    port.close(code, reason);
    watcher.onClosed();
  };

  /**
   * Write one frame, unless client stop reading it.
   *
   * @param {LiveTopic} topic - The slice.
   * @param {unknown} data - Its value.
   */
  const write = <T extends LiveTopic>(topic: T, data: LiveTopicMap[T]): void => {
    port.send(encodeEnvelope(topic, data, deps.clock()));
  };

  /**
   * Send whole state for watched plan. Every resync — after auth, after watch,
   * after drained buffer — be this. A snapshot that cannot build become `error`
   * frame and session stay open.
   *
   * @returns {Promise<void>} Resolve once sent, or once failure be reported.
   */
  const sendHello = async (): Promise<void> => {
    // Serialised, because `receive` be async and nothing upstream serialise it:
    // client can write thirty `watch` frame in one TCP segment and every one
    // reach this before first snapshot resolve. One in flight, last win.
    if (sending) {
      pending = true;
      return;
    }
    if (port.bufferedAmount() >= BACKPRESSURE_SKIP_BYTES) {
      if (!stale) {
        stale = true;
        staleSince = deps.clock();
      }
      return;
    }
    sending = true;
    let snapshot: PawSnapshot;
    try {
      snapshot = await deps.snapshot(watched);
    } catch (error: unknown) {
      sending = false;
      // `pending` resets on failure: otherwise a `watch` received while this
      // build failed would stay set and a later successful build would send a
      // redundant snapshot.
      pending = false;
      deps.warn(
        `snapshot failed for ${watched ?? '(no plan)'}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      if (state === 'live') {
        write('error', {
          code: 'snapshot-failed',
          message: 'the daemon could not read that plan — see its terminal',
        });
      }
      return;
    }
    sending = false;
    if (state !== 'live') {
      pending = false;
      return;
    }
    // Checked again after await: the buffer this snapshot joins is the one at
    // send time, and building the snapshot took time.
    if (port.bufferedAmount() >= BACKPRESSURE_SKIP_BYTES) {
      pending = false;
      if (!stale) {
        stale = true;
        staleSince = deps.clock();
      }
      return;
    }
    write('hello', snapshot);
    if (pending) {
      // A `watch` arrived while this snapshot built, so `watched` changed and
      // the snapshot just sent is for the previous plan. One more pass sends
      // the current plan.
      pending = false;
      await sendHello();
    }
  };

  /**
   * Whether this frame be inside session message allowance.
   *
   * @returns {boolean} True when it may be handled.
   */
  const withinRate = (): boolean => {
    const at = deps.clock();
    if (at - windowStartedAt >= MESSAGE_WINDOW_MS) {
      windowStartedAt = at;
      messagesInWindow = 0;
    }
    messagesInWindow += 1;
    return messagesInWindow <= MAX_MESSAGES_PER_WINDOW;
  };

  return {
    state: () => state,
    watching: () => watched,

    receive: async (raw: string): Promise<void> => {
      if (state === 'closed') {
        return;
      }
      if (!withinRate()) {
        // Rate limit exceeded: close with the capacity code so the client
        // backs off and reconnects instead of being told its frame is
        // malformed.
        shut(CLOSE_CAPACITY, 'too many messages');
        return;
      }
      const message = parseClientMessage(raw);
      if (message === null) {
        shut(CLOSE_MALFORMED, 'malformed frame');
        return;
      }

      if (state === 'pre-auth') {
        if (message.type !== 'auth') {
          // Protocol-order violation, not a failed credential: no credential
          // was offered, so the auth-fail code 4401 would falsely report one
          // and make the console show a lockout.
          shut(CLOSE_MALFORMED, 'authenticate first');
          return;
        }
        if (!verifyToken(deps.token, message.token)) {
          watcher.onAuthFailed();
          shut(CLOSE_AUTH, 'bad credential');
          return;
        }
        state = 'live';
        watcher.onAuthenticated();
        await sendHello();
        return;
      }

      if (message.type === 'auth') {
        shut(CLOSE_MALFORMED, 'already authenticated');
        return;
      }

      if (message.type === 'scope') {
        const problem = dispatchScope(message.path, deps);
        if (problem !== null) {
          write('error', problem);
        }
        return;
      }

      if (message.type === 'attach') {
        write('error', dispatchAttach(message.path, message.mode, deps));
        return;
      }

      if (message.type === 'release') {
        write('error', dispatchRelease(message.settings, deps));
        return;
      }

      if (message.plan !== null && !deps.plans().includes(message.plan)) {
        // A plan outside repository be refused without being opened, and session
        // keep whatever it already watch.
        write('error', {
          code: 'unknown-plan',
          message: 'no such plan in this repository',
        });
        return;
      }
      watched = message.plan;
      await sendHello();
    },

    emit: <T extends LiveTopic>(topic: T, data: LiveTopicMap[T]): void => {
      if (state !== 'live') {
        return;
      }
      const buffered = port.bufferedAmount();
      if (buffered >= BACKPRESSURE_CLOSE_BYTES) {
        shut(CLOSE_BACKPRESSURE, 'client is not reading');
        return;
      }
      if (buffered >= BACKPRESSURE_SKIP_BYTES) {
        if (!stale) {
          stale = true;
          staleSince = deps.clock();
        }
        return;
      }
      if (stale) {
        if (buffered > BACKPRESSURE_RESUME_BYTES) {
          return;
        }
        // Drained. The client missed events and there is no replay buffer, so
        // it receives the whole state to resynchronise.
        stale = false;
        void sendHello();
        return;
      }
      if (topic === 'planDetail' && (data as PlanSlice).selectedPlan !== watched) {
        // `planDetail` events broadcast to every session, and sessions may
        // watch different plans. Forwarding one would show this session a brief
        // for a different plan — stale data rendered as current.
        return;
      }
      write(topic, data);
    },

    tick: (nowMs: number): void => {
      if (state === 'pre-auth' && nowMs - openedAt >= AUTH_TIMEOUT_MS) {
        // Auth timeout is a protocol failure, not a credential failure:
        // daemon received no credential, so not counted as an auth failure;
        // sending 4401 would wrongly make a slow client stop retrying.
        shut(CLOSE_MALFORMED, 'no credential offered in time');
        return;
      }
      if (state === 'live' && stale && nowMs - staleSince >= BACKPRESSURE_STALE_MS) {
        shut(CLOSE_BACKPRESSURE, 'client stopped reading');
      }
    },

    close: shut,
  };
}
