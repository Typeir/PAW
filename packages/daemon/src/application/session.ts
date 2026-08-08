/**
 * PAW Live Session
 *
 * @fileoverview One authenticated WebSocket, as a state machine over a seam. The
 * socket lives in `infrastructure`; everything that decides *what happens* lives
 * here, pure over {@link WsSessionPort}, which is what makes the security-relevant
 * behaviour testable by driving the machine rather than racing a socket.
 *
 * The rules: nothing is sent before the first frame authenticates — not a hello,
 * not an error body, not a topic name. The credential is compared in constant
 * time over SHA-256 digests. A failed authentication is counted and reported but
 * never turned into a lockout, because on loopback that would let any local
 * process lock the operator out of their own console. A client that stops reading
 * is dropped, not queued for: events are skipped past a threshold and it gets a
 * fresh hello when its buffer drains — there is no replay buffer anywhere.
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
 * Build one live session over a socket.
 *
 * @param {WsSessionPort} port - The socket.
 * @param {SessionDeps} deps - What the daemon supplies.
 * @param {SessionWatcher} watcher - Told of auth and close, for the registry's counts.
 * @param {string | null} openedOn - The plan it starts watching, if any.
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
  // One snapshot in flight at a time; `pending` remembers that another was
  // asked for while it was building.
  let sending = false;
  let pending = false;
  let windowStartedAt = deps.clock();
  let messagesInWindow = 0;
  const openedAt = deps.clock();

  /**
   * Close and stop, once. Every path out of this session goes through here so
   * the registry's count cannot drift from the sockets that are actually open.
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
   * Write one frame, unless the client has stopped reading it.
   *
   * @param {LiveTopic} topic - The slice.
   * @param {unknown} data - Its value.
   */
  const write = <T extends LiveTopic>(topic: T, data: LiveTopicMap[T]): void => {
    port.send(encodeEnvelope(topic, data, deps.clock()));
  };

  /**
   * Send the whole state for the watched plan. Every resync — after auth, after a
   * watch, after a drained buffer — is this and nothing cleverer.
   *
   * A snapshot that cannot be built is the daemon's problem, not the client's, so
   * it becomes an `error` frame and the session stays open: a plan module that
   * stopped parsing is something the operator fixes in their editor, and dropping
   * the console every time they save a broken file would make the tool useless
   * exactly when it is most needed.
   *
   * @returns {Promise<void>} Resolves once sent, or once the failure is reported.
   */
  const sendHello = async (): Promise<void> => {
    // Serialised, because `receive` is async and nothing upstream serialises it:
    // a client can write thirty `watch` frames in one TCP segment and every one
    // reaches this before the first snapshot resolves. One in flight, last wins.
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
      // Cleared, not carried: a request that arrived while this build was failing
      // would otherwise sit set until a later success sent a redundant snapshot.
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
    // Re-checked after the await: the buffer this snapshot joins is the one that
    // exists now, and building it took time.
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
      // A `watch` arrived while this one was building, so `watched` moved on and
      // the snapshot just sent describes the wrong plan. One more pass settles it.
      pending = false;
      await sendHello();
    }
  };

  /**
   * Whether this frame is inside the session's message allowance.
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
        // Capacity, not malformity: back off and come back rather than give up.
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
          // A protocol-order violation, not an authentication one: it presented no
          // credential, so 4401 would be a lie and would latch a console locked-out.
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
        // A plan outside the repository is refused without being opened, and the
        // session keeps whatever it was already watching.
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
        // Drained. It missed events and there is no replay, so it gets the whole
        // state back rather than a stream it cannot reassemble.
        stale = false;
        void sendHello();
        return;
      }
      if (topic === 'planDetail' && (data as PlanSlice).selectedPlan !== watched) {
        // The bus carries one plan's detail to every session, and sessions watch
        // different plans. Sending this on would show a console another plan's
        // briefs — wrong data, rendered as though it were right.
        return;
      }
      write(topic, data);
    },

    tick: (nowMs: number): void => {
      if (state === 'pre-auth' && nowMs - openedAt >= AUTH_TIMEOUT_MS) {
        // A protocol failure, not an authentication one: it made no guess, so it
        // is not counted, and 4401 would wrongly stop a slow socket from retrying.
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
