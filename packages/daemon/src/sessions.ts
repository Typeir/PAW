/**
 * PAW Live Sessions
 *
 * @fileoverview One authenticated WebSocket, as a state machine over a seam.
 *
 * The socket itself lives in `nodeRuntime`; everything that decides *what
 * happens* lives here, pure over {@link WsSessionPort}. That is what makes the
 * security-relevant behaviour testable: "no byte of data before authentication"
 * is a property of this file, provable by driving the machine and asserting
 * `send` was never called, rather than a property of a socket that a test would
 * have to race.
 *
 * The rules, and why each exists:
 *
 * **Nothing is sent before the first frame authenticates.** Not a `hello`, not
 * an error body, not a topic name. Anything on the machine can open this socket;
 * until it proves it read the URL the daemon printed, it learns nothing — not
 * even whether a plan is loaded.
 *
 * **The credential is compared in constant time**, over SHA-256 digests of both
 * sides, so neither the comparison nor a length mismatch is an oracle.
 *
 * **A failed authentication is counted and reported, never turned into a
 * lockout.** On loopback the daemon cannot tell one local peer from another, so
 * refusing service after N failures would let any local process lock the
 * operator out of their own console — a denial of service strictly worse than
 * the guessing it would prevent, against a 256-bit credential behind a
 * four-socket pre-auth cap. A socket that merely goes quiet is not counted at
 * all: it made no guess, and it is closed with a code its console can retry on.
 *
 * **A client that stops reading is dropped, not queued for.** Events are skipped
 * once its buffer passes a threshold and the session is marked stale; when the
 * buffer drains it gets a fresh `hello` rather than the events it missed. There
 * is no replay buffer anywhere in this protocol, which is what keeps a slow
 * console from becoming the daemon's memory problem.
 *
 * @module @paw/daemon/sessions
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
  CLOSE_SHUTDOWN,
  MAX_AUTH_FAILURES,
  MAX_MESSAGES_PER_WINDOW,
  MESSAGE_WINDOW_MS,
  encodeEnvelope,
  parseClientMessage,
  type LiveTopic,
  type LiveTopicMap,
  type PawSnapshot,
  type PlanSlice,
} from '@paw/core';
import { verifyToken } from './security.js';

/**
 * The socket, as this file needs it.
 *
 * @interface WsSessionPort
 * @property {() => void} send - Send one frame of text.
 * @property {(code: number, reason: string) => void} close - Close with a code.
 * @property {() => number} bufferedAmount - Bytes queued and not yet written.
 */
export interface WsSessionPort {
  send(text: string): void;
  close(code: number, reason: string): void;
  bufferedAmount(): number;
}

/**
 * What a session needs from the daemon around it.
 *
 * @interface SessionDeps
 * @property {string} token - The credential a client must present.
 * @property {() => number} clock - Epoch milliseconds; stamps frames and drives windows and staleness.
 * @property {(plan: string | null) => Promise<PawSnapshot>} snapshot - The full state for a plan.
 * @property {() => readonly string[]} plans - The plans the repository holds.
 * @property {(message: string) => void} warn - Report something without dying of it.
 */
export interface SessionDeps {
  readonly token: string;
  clock(): number;
  snapshot(plan: string | null): Promise<PawSnapshot>;
  plans(): readonly string[];
  warn(message: string): void;
}

/**
 * Where a session is in its life.
 *
 * @typedef {'pre-auth' | 'live' | 'closed'} SessionState
 */
export type SessionState = 'pre-auth' | 'live' | 'closed';

/**
 * One connected client.
 *
 * @interface LiveSession
 * @property {() => SessionState} state - Where it is.
 * @property {() => string | null} watching - Which plan it is watching.
 * @property {(raw: string) => Promise<void>} receive - Handle one client frame.
 * @property {Function} emit - Offer it a published slice.
 * @property {(nowMs: number) => void} tick - Advance its timers.
 * @property {(code: number, reason: string) => void} close - Close it.
 */
export interface LiveSession {
  state(): SessionState;
  watching(): string | null;
  receive(raw: string): Promise<void>;
  emit<T extends LiveTopic>(topic: T, data: LiveTopicMap[T]): void;
  tick(nowMs: number): void;
  close(code: number, reason: string): void;
}

/**
 * Told when a session authenticates or fails to, so the registry can hold the
 * counts one socket cannot see.
 *
 * @interface SessionWatcher
 * @property {() => void} onAuthenticated - The session proved itself.
 * @property {() => void} onAuthFailed - It did not.
 * @property {() => void} onClosed - It is gone.
 */
export interface SessionWatcher {
  onAuthenticated(): void;
  onAuthFailed(): void;
  onClosed(): void;
}

/**
 * Build one session over a socket.
 *
 * @param {WsSessionPort} port - The socket.
 * @param {SessionDeps} deps - What the session needs.
 * @param {SessionWatcher} watcher - The registry's counters.
 * @param {string | null} openedOn - The plan to watch until told otherwise.
 * @returns {LiveSession} The session.
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
   * Send the whole state for the watched plan. Every resync — after auth, after
   * a watch, after a drained buffer — is this and nothing cleverer.
   *
   * A snapshot that cannot be built is the daemon's problem, not the client's,
   * so it becomes an `error` frame and the session stays open: a plan module
   * that stopped parsing is something the operator fixes in their editor, and
   * dropping the console every time they save a broken file would make the tool
   * useless exactly when it is most needed. The detail goes to the operator's
   * terminal; the client is told what happened and nothing about where.
   *
   * @returns {Promise<void>} Resolves once sent, or once the failure is reported.
   */
  const sendHello = async (): Promise<void> => {
    // Serialised, because `receive` is async and nothing upstream serialises it:
    // a client can write thirty `watch` frames in one TCP segment and every one
    // of them reaches this function before the first snapshot resolves. Checking
    // the buffer without this guard measures a buffer that is still empty, and
    // the daemon builds and queues thirty full snapshots for a socket it is
    // not reading — a rate limit on *messages* with no limit on the memory they
    // cost. One in flight, and the last request wins.
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
      // Cleared, not carried: a request that arrived while this build was
      // failing would otherwise sit set until some later success noticed it and
      // sent a second, redundant snapshot. Retrying a build that just threw is
      // not useful either — the plan is broken until the operator fixes it.
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
    // Re-checked after the await, not only before it: the buffer this snapshot
    // is about to join is the one that exists now, and building it took time.
    if (port.bufferedAmount() >= BACKPRESSURE_SKIP_BYTES) {
      // Dropped along with the frame. Honouring it later would send a second
      // full snapshot at the moment the client is least able to read one; the
      // drain path resynchronises from `watched`, which is already current.
      pending = false;
      if (!stale) {
        stale = true;
        staleSince = deps.clock();
      }
      return;
    }
    write('hello', snapshot);
    if (pending) {
      // A `watch` arrived while this one was building, so `watched` has already
      // moved on and the snapshot just sent describes the wrong plan. One more
      // pass settles it — the client asked last for what it now gets.
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
        // Capacity, not malformity: this tells a console to back off and come
        // back rather than to give up on the daemon entirely.
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
          // Closed as a protocol-order violation, not an authentication one. It
          // presented no credential, so 4401 would be a lie — and a console told
          // 4401 latches into a terminal locked-out state for the life of the
          // page, which is a very expensive answer to "you spoke out of turn".
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

      if (message.plan !== null && !deps.plans().includes(message.plan)) {
        // A plan outside the repository is refused without being opened, and the
        // session keeps whatever it was already watching.
        write('error', { code: 'unknown-plan', message: 'no such plan in this repository' });
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
        // different plans. Sending this on would show a console the briefs of a
        // plan it did not select — wrong data, rendered as though it were right.
        return;
      }
      write(topic, data);
    },

    tick: (nowMs: number): void => {
      if (state === 'pre-auth' && nowMs - openedAt >= AUTH_TIMEOUT_MS) {
        // Closed as a protocol failure, not an authentication failure. It made
        // no guess, so it is not counted as one; and 4401 would tell a console
        // its credential is bad and stop it retrying, when all that happened is
        // that a socket was slow.
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

/**
 * Every open session, and the counts the upgrade gate reads.
 *
 * @interface SessionRegistry
 * @property {Function} open - Register a new socket as a session.
 * @property {() => number} live - How many have authenticated.
 * @property {() => number} preAuth - How many have not yet.
 * @property {() => number} failedAuths - How many credentials have been refused, for reporting.
 * @property {() => readonly string[]} watched - Every plan a live session is watching, deduplicated.
 * @property {Function} broadcast - Offer a slice to every live session.
 * @property {(nowMs: number) => void} tick - Advance every session's timers.
 * @property {() => void} shutdown - Close every session, because the daemon is going away.
 */
export interface SessionRegistry {
  open(port: WsSessionPort, openedOn: string | null): LiveSession;
  live(): number;
  preAuth(): number;
  failedAuths(): number;
  watched(): readonly string[];
  broadcast<T extends LiveTopic>(topic: T, data: LiveTopicMap[T]): void;
  tick(nowMs: number): void;
  shutdown(): void;
}

/**
 * Build the registry.
 *
 * @param {SessionDeps} deps - What sessions need.
 * @returns {SessionRegistry} The registry.
 */
export function createSessionRegistry(deps: SessionDeps): SessionRegistry {
  const sessions = new Set<LiveSession>();
  let failures = 0;

  return {
    open: (port: WsSessionPort, openedOn: string | null): LiveSession => {
      const session = createSession(
        port,
        deps,
        {
          onAuthenticated: () => undefined,
          onAuthFailed: () => {
            failures += 1;
            if (failures % MAX_AUTH_FAILURES === 0) {
              deps.warn(
                `${failures} failed live-wire authentications so far — ` +
                  `something on this machine is guessing at the console's credential`,
              );
            }
          },
          onClosed: () => {
            sessions.delete(session);
          },
        },
        openedOn,
      );
      sessions.add(session);
      return session;
    },

    live: () => [...sessions].filter((session) => session.state() === 'live').length,

    preAuth: () => [...sessions].filter((session) => session.state() === 'pre-auth').length,

    failedAuths: () => failures,

    // What the plan source must keep fresh. A session watching a plan the
    // daemon did not open on would otherwise never be sent an update for it —
    // the filter in `emit` drops the wrong plan's slice, and nothing would ever
    // publish the right one, so the console would render stale briefs while
    // reporting itself live.
    watched: () => [
      ...new Set(
        [...sessions]
          .filter((session) => session.state() === 'live')
          .map((session) => session.watching())
          .filter((plan): plan is string => plan !== null),
      ),
    ],

    broadcast: <T extends LiveTopic>(topic: T, data: LiveTopicMap[T]): void => {
      for (const session of [...sessions]) {
        session.emit(topic, data);
      }
    },

    tick: (nowMs: number): void => {
      for (const session of [...sessions]) {
        session.tick(nowMs);
      }
    },

    shutdown: (): void => {
      for (const session of [...sessions]) {
        session.close(CLOSE_SHUTDOWN, 'pawd is shutting down');
      }
    },
  };
}
