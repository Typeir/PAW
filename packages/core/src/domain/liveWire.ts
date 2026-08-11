/**
 * PAW Live Wire Protocol
 *
 * @fileoverview The `paw.live.v1` contract: what daemon and console agree frame
 * is, what close codes mean, and how received frame parse.
 *
 * This live in `@paw/core` because both sides must agree exactly, and GUI only
 * import from core. Two copied implementations on each side diverge; a wire
 * protocol that drifts on a security boundary can accept more than intended.
 *
 * Parsers are **allow-lists**. `parseClientMessage` build new
 * object out of two or three field it recognise and return null for everything
 * else; it never return caller's parsed JSON. A validator that checks some
 * field and passes the object through would carry whatever else is in it —
 * prototype keys, extra properties later refactor start trusting — into daemon.
 * Nothing crosses this boundary that is not named here.
 *
 * Wire form be **atomic**: one-character key and two-character topic code.
 * Host slice tick once a second per open console, so envelope's own overhead
 * paid several thousand time an hour while console open; `{"v":1,"t":"ho","a":1786060800000,...}` cost 28 byte of framing where spelled-out form cost 63. This file be **only** place compact form exist — everything above read `topic: 'host'`; two-letter codes cannot be grepped.
 *
 * @module @paw/core/domain/liveWire
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ClientMessage, LiveEnvelope, LiveTopic, LiveTopicMap, RunSettings } from '../contracts.js';
import type { InitMode } from './initConfig.js';

/**
 * WebSocket subprotocol daemon require. Client no offer it get refused before
 * upgrade: either different version or an unauthenticated peer, and neither should reach socket.
 */
export const LIVE_SUBPROTOCOL = 'paw.live.v1';

/**
 * Protocol version carried in every frame.
 */
export const LIVE_VERSION = 1;

/**
 * Every topic and the two character it travel as. One table, read in both
 * direction, so topic cannot be added to wire without added here and cannot be encoded one thing and decoded another.
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
  attach: 'at',
};

/**
 * Every topic, as value — guard need list, not just type.
 */
export const LIVE_TOPICS: readonly LiveTopic[] = Object.keys(TOPIC_CODES) as LiveTopic[];

/**
 * Reverse of {@link TOPIC_CODES}, derived from the same table.
 */
const TOPIC_BY_CODE = new Map<string, LiveTopic>(
  LIVE_TOPICS.map((topic) => [TOPIC_CODES[topic], topic]),
);

/**
 * Wire code for `auth` message.
 */
export const AUTH_CODE = 'a';

/**
 * Wire code for `watch` message.
 */
export const WATCH_CODE = 'w';

/**
 * Message code attach request travel as.
 */
export const ATTACH_CODE = 't';

/**
 * Message code scope request travel as. Scoping be read — see
 * {@link withinRoot} for ceiling it held to.
 */
export const SCOPE_CODE = 'r';

/**
 * Message code release request travel as. Like {@link ATTACH_CODE}, it
 * only ask: operator approve it in terminal before live herd run.
 */
export const RELEASE_CODE = 'x';

/**
 * Init modes attach request may name. Listed here so the wire refuses a
 * mode the domain does not have and never passes an unknown string inward.
 */
const ATTACH_MODES: readonly InitMode[] = ['create', 'merge', 'override'];

/**
 * Whether value be one of init modes.
 *
 * @param {unknown} value - The candidate.
 * @returns {boolean} True when it name a mode.
 */
function isInitMode(value: unknown): value is InitMode {
  return ATTACH_MODES.some((mode) => mode === value);
}

/**
 * Whether value be optional count — omitted, or whole number of one or
 * more. Used for release settings console cannot be trusted to have validated.
 *
 * @param {unknown} value - The candidate.
 * @returns {boolean} True when absent or valid count.
 */
function isOptionalCount(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 1);
}

/**
 * Rebuild {@link RunSettings} from wire value, field by field, or null when any
 * field missing or malformed. Like the rest of the module it is an allow-list:
 * a frame naming an unknown-shaped setting is refused whole.
 *
 * @param {unknown} value - The candidate settings object.
 * @returns {RunSettings | null} The settings, or null.
 */
function parseRunSettings(value: unknown): RunSettings | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const maxOutputTokens = raw.maxOutputTokens;
  const concurrency = raw.concurrency;
  const context = raw.context;
  if (typeof raw.plan !== 'string' || raw.plan.length === 0 || typeof raw.live !== 'boolean') {
    return null;
  }
  if (!isOptionalCount(maxOutputTokens) || !isOptionalCount(concurrency)) {
    return null;
  }
  if (context !== undefined && !(Array.isArray(context) && context.every((entry) => typeof entry === 'string'))) {
    return null;
  }
  return {
    plan: raw.plan,
    live: raw.live,
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(context !== undefined ? { context: context as string[] } : {}),
  };
}

/**
 * Close codes. 4000–4999 range reserved for application, so these ours to
 * define; `1001` and `1013` standard and keep standard meanings.
 *
 * The codes are distinct. A console told `4401` knows the token is wrong
 * and must stop retrying; one told `4429` knows to back off and try later.
 * Collapsing them into a generic failure produces a client that reconnects
 * forever against a daemon that never accepts it.
 */
export const CLOSE_MALFORMED = 4400;

/**
 * Authentication fail, or no `auth` frame arrive in time.
 */
export const CLOSE_AUTH = 4401;

/**
 * The `Origin` not allowed to talk to this daemon.
 */
export const CLOSE_ORIGIN = 4403;

/**
 * Too many session, or too many attempt.
 */
export const CLOSE_CAPACITY = 4429;

/**
 * Client stop reading and buffer grow past what daemon hold.
 */
export const CLOSE_BACKPRESSURE = 1013;

/**
 * Daemon go away.
 */
export const CLOSE_SHUTDOWN = 1001;

/**
 * Largest frame daemon accept from client. `auth` frame be token and `watch`
 * frame be path; nothing legitimate approach this, so limit cost nothing and
 * remove memory exhaustion as option.
 */
export const MAX_FRAME_BYTES = 4096;

/**
 * How long freshly upgraded socket have to present credential before close.
 * No byte of data send before it do.
 */
export const AUTH_TIMEOUT_MS = 2000;

/**
 * How often daemon ping live session.
 */
export const PING_MS = 15_000;

/**
 * How long daemon wait for pong before drop session.
 */
export const PONG_TIMEOUT_MS = 10_000;

/**
 * How long client tolerate hearing nothing before assume wire dead. Host
 * topic tick every second, so this be five missed tick.
 */
export const CLIENT_SILENCE_MS = 5000;

/**
 * How many authenticated session daemon hold at once.
 */
export const MAX_SESSIONS = 16;

/**
 * How many socket may sit un-authenticated at once. Lower than session
 * limit because unauthenticated socket cost daemon timer and buffer and prove
 * nothing.
 */
export const MAX_PREAUTH_SESSIONS = 4;

/**
 * How many message one session send per {@link MESSAGE_WINDOW_MS}.
 */
export const MAX_MESSAGES_PER_WINDOW = 30;

/**
 * Rate-limit window.
 */
export const MESSAGE_WINDOW_MS = 10_000;

/**
 * How many refused credential daemon let pass before log them on operator's
 * terminal.
 *
 * This is a **reporting** threshold; it never locks out. On loopback daemon
 * cannot attribute socket to peer, so refusing service after N failures would
 * let any local process lock the operator out — a denial of service worse than
 * the guessed credential it would prevent, against a 256-bit credential behind
 * a four-socket pre-auth cap.
 */
export const MAX_AUTH_FAILURES = 10;

/**
 * Buffered bytes at which daemon stop sending session event and mark it
 * stale. No more frames queue for a client that does not read.
 */
export const BACKPRESSURE_SKIP_BYTES = 1_048_576;

/**
 * Buffered bytes at which stale session close outright.
 */
export const BACKPRESSURE_CLOSE_BYTES = 5_242_880;

/**
 * Buffered bytes below which stale session considered drained and send
 * fresh `hello` to resynchronise.
 */
export const BACKPRESSURE_RESUME_BYTES = 65_536;

/**
 * How long session stay stale before close even if buffer never grow further.
 */
export const BACKPRESSURE_STALE_MS = 30_000;

/**
 * Whether value name a topic.
 *
 * @param {unknown} value - The candidate.
 * @returns {value is LiveTopic} True when it be known topic.
 */
export function isLiveTopic(value: unknown): value is LiveTopic {
  return typeof value === 'string' && (LIVE_TOPICS as readonly string[]).includes(value);
}

/**
 * Topic wire code name, or null when name none.
 *
 * @param {unknown} code - The frame's `t` field.
 * @returns {LiveTopic | null} The topic, or null.
 */
export function topicOfCode(code: unknown): LiveTopic | null {
  return typeof code === 'string' ? (TOPIC_BY_CODE.get(code) ?? null) : null;
}

/**
 * Parse text into plain JSON object, or null when anything else.
 *
 * Array and primitive refused, and so be `null`. Reading a field off a
 * non-object gives `undefined` with no error; that path lets the parser
 * accept `"[]"` as a message.
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
 * Parse client frame into one of two message daemon accept.
 *
 * Return null for everything else — wrong version, unknown type, token that
 * no string, plan that neither string nor null, frame over size limit. Caller
 * close with {@link CLOSE_MALFORMED}; no negotiation and no partial acceptance.
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
  if (message.m === SCOPE_CODE) {
    const path = message.p;
    return typeof path === 'string' && path.length > 0
      ? { v: LIVE_VERSION, type: 'scope', path }
      : null;
  }
  if (message.m === ATTACH_CODE) {
    const path = message.p;
    const mode = message.d;
    if (typeof path !== 'string' || path.length === 0) {
      return null;
    }
    return isInitMode(mode)
      ? { v: LIVE_VERSION, type: 'attach', path, mode }
      : null;
  }
  if (message.m === RELEASE_CODE) {
    const settings = parseRunSettings(message.s);
    return settings === null ? null : { v: LIVE_VERSION, type: 'release', settings };
  }
  return null;
}

/**
 * Serialise server frame, in compact wire form.
 *
 * @param {LiveTopic} topic - Which slice this be.
 * @param {unknown} data - Its new value.
 * @param {number} at - When sent, epoch milliseconds.
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
 * Parse server frame, for console side.
 *
 * Payload not inspected beyond being present: topic determine its shape, and
 * console apply it through same validation its HTTP hydration use. This
 * guarantee code name topic console know, so reducer never dispatch on
 * something it have no arm for.
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
 * The `auth` frame client send first.
 *
 * @param {string} token - The credential from URL fragment.
 * @returns {string} The frame's text.
 */
export function authFrame(token: string): string {
  return JSON.stringify({ v: LIVE_VERSION, m: AUTH_CODE, k: token });
}

/**
 * The `watch` frame client send when operator pick plan.
 *
 * @param {string | null} plan - The plan to watch, or null for none.
 * @returns {string} The frame's text.
 */
export function watchFrame(plan: string | null): string {
  return JSON.stringify({ v: LIVE_VERSION, m: WATCH_CODE, p: plan });
}

/**
 * The `attach` frame console send to ask that PAW be attached to
 * repository. Asking be all it do — see {@link ClientMessage}.
 *
 * @param {string} path - Absolute path to repository root.
 * @param {InitMode} mode - How to resolve existing config.
 * @returns {string} The frame's text.
 */
export function encodeAttach(path: string, mode: InitMode): string {
  return JSON.stringify({ v: LIVE_VERSION, m: ATTACH_CODE, p: path, d: mode });
}

/**
 * The `scope` frame console send to point unscoped daemon at
 * repository. A read, like {@link watchFrame} — nothing written and no
 * approval sought.
 *
 * @param {string} path - Absolute path to repository root.
 * @returns {string} The frame's text.
 */
export function encodeScope(path: string): string {
  return JSON.stringify({ v: LIVE_VERSION, m: SCOPE_CODE, p: path });
}

/**
 * The `release` frame console, TUI, or `paw ui` send to ask daemon run
 * plan's herd. Asking be all it do — operator approve it in terminal before
 * live run spend anything. See {@link ClientMessage}.
 *
 * @param {RunSettings} settings - What to run and how.
 * @returns {string} The frame's text.
 */
export function encodeRelease(settings: RunSettings): string {
  return JSON.stringify({ v: LIVE_VERSION, m: RELEASE_CODE, s: settings });
}
