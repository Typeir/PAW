/**
 * PAW Live Wire Protocol
 *
 * @fileoverview The `paw.live.v1` contract: what the daemon and the console
 * agree a frame is, what the close codes mean, and — the part that carries the
 * weight — how a received frame is parsed.
 *
 * This lives in `@paw/core` because it is the one thing both sides must agree
 * on exactly, and the GUI may only import from core. A copy on each side would
 * be a protocol that drifts, and a protocol that drifts on a security boundary
 * drifts in the direction of accepting more than it should.
 *
 * The parsers are **allow-lists, not validators**. `parseClientMessage` builds a
 * new object out of the two or three fields it recognises and returns null for
 * everything else; it never returns the caller's parsed JSON. That is deliberate:
 * a validator that checks some fields and passes the object through carries
 * whatever else was in it — prototype keys, extra properties a later refactor
 * starts trusting — into the daemon. Nothing crosses this boundary that was not
 * named here.
 *
 * The wire form is **atomic**: one-character keys and two-character topic codes.
 * The host slice ticks once a second per open console, so the envelope's own
 * overhead is paid several thousand times an hour for as long as a console is
 * open; `{"v":1,"t":"ho","a":1786060800000,...}` costs 28 bytes of framing where
 * the spelled-out form costs 63. This file is the **only** place the compact
 * form exists — everything above it reads `topic: 'host'`, because a codebase
 * that speaks in two-letter codes is a codebase nobody can grep.
 *
 * @module @paw/core/domain/liveWire
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ClientMessage, LiveEnvelope, LiveTopic, LiveTopicMap } from '../contracts.js';

/**
 * The WebSocket subprotocol the daemon requires. A client that does not offer it
 * is refused before the upgrade: it is either a different version or something
 * that found the port and started talking, and neither should reach the socket.
 */
export const LIVE_SUBPROTOCOL = 'paw.live.v1';

/**
 * The protocol version carried in every frame.
 */
export const LIVE_VERSION = 1;

/**
 * Every topic and the two characters it travels as. One table, read in both
 * directions, so a topic cannot be added to the wire without being added here
 * and cannot be encoded as one thing and decoded as another.
 */
export const TOPIC_CODES: Readonly<Record<LiveTopic, string>> = {
  hello: 'he',
  host: 'ho',
  processes: 'ps',
  plans: 'pl',
  planDetail: 'pd',
  doctor: 'dr',
  run: 'rn',
  budget: 'bg',
  tree: 'tr',
  log: 'lg',
  error: 'er',
};

/**
 * Every topic, as a value — the guard needs a list, not just a type.
 */
export const LIVE_TOPICS: readonly LiveTopic[] = Object.keys(TOPIC_CODES) as LiveTopic[];

/**
 * The reverse of {@link TOPIC_CODES}, built from it rather than written twice.
 */
const TOPIC_BY_CODE = new Map<string, LiveTopic>(
  LIVE_TOPICS.map((topic) => [TOPIC_CODES[topic], topic]),
);

/**
 * The wire code for an `auth` message.
 */
export const AUTH_CODE = 'a';

/**
 * The wire code for a `watch` message.
 */
export const WATCH_CODE = 'w';

/**
 * Close codes. The 4000–4999 range is reserved for applications, so these are
 * ours to define; `1001` and `1013` are the standard ones and keep their
 * standard meanings.
 *
 * They are distinct on purpose. A console that is told `4401` knows the token is
 * wrong and must stop retrying; one told `4429` knows to back off and try later.
 * Collapsing them into a generic failure is what produces a client that
 * reconnects forever against a daemon that will never accept it.
 */
export const CLOSE_MALFORMED = 4400;

/**
 * Authentication failed, or no `auth` frame arrived in time.
 */
export const CLOSE_AUTH = 4401;

/**
 * The `Origin` is not allowed to talk to this daemon.
 */
export const CLOSE_ORIGIN = 4403;

/**
 * Too many sessions, or too many attempts.
 */
export const CLOSE_CAPACITY = 4429;

/**
 * The client stopped reading and its buffer grew past what the daemon will hold.
 */
export const CLOSE_BACKPRESSURE = 1013;

/**
 * The daemon is going away.
 */
export const CLOSE_SHUTDOWN = 1001;

/**
 * The largest frame the daemon will accept from a client. An `auth` frame is a
 * token and a `watch` frame is a path; nothing legitimate approaches this, so
 * the limit costs nothing and removes memory exhaustion as an option.
 */
export const MAX_FRAME_BYTES = 4096;

/**
 * How long a freshly upgraded socket has to present its credential before it is
 * closed. No byte of data is sent before it does.
 */
export const AUTH_TIMEOUT_MS = 2000;

/**
 * How often the daemon pings a live session.
 */
export const PING_MS = 15_000;

/**
 * How long the daemon waits for a pong before dropping the session.
 */
export const PONG_TIMEOUT_MS = 10_000;

/**
 * How long a client should tolerate hearing nothing at all before it assumes the
 * wire is dead. The host topic ticks every second, so this is five missed ticks.
 */
export const CLIENT_SILENCE_MS = 5000;

/**
 * How many authenticated sessions the daemon will hold at once.
 */
export const MAX_SESSIONS = 16;

/**
 * How many sockets may sit un-authenticated at once. Lower than the session
 * limit because an unauthenticated socket costs the daemon a timer and a buffer
 * and has proved nothing.
 */
export const MAX_PREAUTH_SESSIONS = 4;

/**
 * How many messages one session may send per {@link MESSAGE_WINDOW_MS}.
 */
export const MAX_MESSAGES_PER_WINDOW = 30;

/**
 * The rate-limit window.
 */
export const MESSAGE_WINDOW_MS = 10_000;

/**
 * How many refused credentials the daemon lets pass before it says so on the
 * operator's terminal.
 *
 * This is a **reporting** threshold, not a lockout. On loopback the daemon
 * cannot attribute a socket to a peer, so refusing service after N failures
 * would let any local process lock the operator out of their own console — a
 * denial of service strictly worse than the guessing it would prevent, against
 * a 256-bit credential behind a four-socket pre-auth cap.
 */
export const MAX_AUTH_FAILURES = 10;

/**
 * Buffered bytes at which the daemon stops sending a session events and marks it
 * stale, rather than queueing more for a client that is not reading.
 */
export const BACKPRESSURE_SKIP_BYTES = 1_048_576;

/**
 * Buffered bytes at which a stale session is closed outright.
 */
export const BACKPRESSURE_CLOSE_BYTES = 5_242_880;

/**
 * Buffered bytes below which a stale session is considered drained and is sent a
 * fresh `hello` to resynchronise.
 */
export const BACKPRESSURE_RESUME_BYTES = 65_536;

/**
 * How long a session may stay stale before it is closed even if its buffer never
 * grows further.
 */
export const BACKPRESSURE_STALE_MS = 30_000;

/**
 * Whether a value names a topic.
 *
 * @param {unknown} value - The candidate.
 * @returns {value is LiveTopic} True when it is a known topic.
 */
export function isLiveTopic(value: unknown): value is LiveTopic {
  return typeof value === 'string' && (LIVE_TOPICS as readonly string[]).includes(value);
}

/**
 * The topic a wire code names, or null when it names none.
 *
 * @param {unknown} code - The frame's `t` field.
 * @returns {LiveTopic | null} The topic, or null.
 */
export function topicOfCode(code: unknown): LiveTopic | null {
  return typeof code === 'string' ? (TOPIC_BY_CODE.get(code) ?? null) : null;
}

/**
 * Parse text into a plain JSON object, or null when it is anything else.
 *
 * Arrays and primitives are refused, and so is `null`. Reading a field off a
 * non-object would be `undefined` rather than an error, which is how a parser
 * ends up accepting `"[]"` as a message.
 *
 * @param {string} raw - The frame's text.
 * @returns {Record<string, unknown> | null} The object, or null.
 */
function parseObject(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

/**
 * Parse a client frame into one of the two messages the daemon accepts.
 *
 * Returns null for everything else — wrong version, unknown type, a token that
 * is not a string, a plan that is neither a string nor null, a frame over the
 * size limit. The caller closes with {@link CLOSE_MALFORMED}; there is no
 * negotiation and no partial acceptance.
 *
 * @param {string} raw - The frame's text.
 * @returns {ClientMessage | null} The message, rebuilt field by field, or null.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_FRAME_BYTES) {
    return null;
  }
  const message = parseObject(raw);
  if (message === null || message.v !== LIVE_VERSION) {
    return null;
  }
  if (message.m === AUTH_CODE) {
    const token = message.k;
    return typeof token === 'string' && token.length > 0
      ? { v: LIVE_VERSION, type: 'auth', token }
      : null;
  }
  if (message.m === WATCH_CODE) {
    const plan = message.p;
    if (plan === null) {
      return { v: LIVE_VERSION, type: 'watch', plan: null };
    }
    return typeof plan === 'string' ? { v: LIVE_VERSION, type: 'watch', plan } : null;
  }
  return null;
}

/**
 * Serialise a server frame, in the compact wire form.
 *
 * @param {LiveTopic} topic - Which slice this is.
 * @param {unknown} data - Its new value.
 * @param {number} at - When it was sent, epoch milliseconds.
 * @returns {string} The frame's text.
 */
export function encodeEnvelope<T extends LiveTopic>(
  topic: T,
  data: LiveTopicMap[T],
  at: number,
): string {
  return JSON.stringify({ v: LIVE_VERSION, t: TOPIC_CODES[topic], a: at, d: data });
}

/**
 * Parse a server frame, for the console side.
 *
 * The payload is not inspected beyond being present: the topic determines its
 * shape, and the console applies it through the same validation its HTTP
 * hydration uses. What this guarantees is that the code names a topic the
 * console knows, so a reducer never dispatches on something it has no arm for.
 *
 * @param {string} raw - The frame's text.
 * @returns {LiveEnvelope | null} The envelope, decoded and rebuilt, or null.
 */
export function parseEnvelope(raw: string): LiveEnvelope | null {
  const frame = parseObject(raw);
  if (frame === null || frame.v !== LIVE_VERSION) {
    return null;
  }
  const topic = topicOfCode(frame.t);
  if (topic === null || typeof frame.a !== 'number' || !('d' in frame)) {
    return null;
  }
  return {
    v: LIVE_VERSION,
    topic,
    at: frame.a,
    data: frame.d as LiveTopicMap[LiveTopic],
  };
}

/**
 * The `auth` frame a client sends first.
 *
 * @param {string} token - The credential from the URL fragment.
 * @returns {string} The frame's text.
 */
export function authFrame(token: string): string {
  return JSON.stringify({ v: LIVE_VERSION, m: AUTH_CODE, k: token });
}

/**
 * The `watch` frame a client sends when the operator picks a plan.
 *
 * @param {string | null} plan - The plan to watch, or null for none.
 * @returns {string} The frame's text.
 */
export function watchFrame(plan: string | null): string {
  return JSON.stringify({ v: LIVE_VERSION, m: WATCH_CODE, p: plan });
}
