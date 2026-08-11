/**
 * PAW Daemon Security Policy
 *
 * @fileoverview Each rule is a pure function over strings deciding which
 * origins and hosts may call the daemon. Policy guards the local control API —
 * report operator host, process table, repository tree, briefs — decided in
 * unit tests, not inside the socket callback.
 *
 * Three gates. **Token** stops another process on the machine: 256 bits, minted
 * per boot, compared in constant time. **Origin** allow-list stops a web page
 * the operator has open from sending requests to loopback and opening
 * WebSockets (upgrade handshake exempt from CORS). **Host** allow-list stops
 * DNS rebinding, where a page points its own name at 127.0.0.1 and inherits the
 * daemon origin. TLS also fails rebinding at handshake.
 *
 * CORS here deny-by-default: daemon emits no
 * `Access-Control-Allow-Origin` unless the request origin is on the list, and
 * never emits `Access-Control-Allow-Credentials`. With no cookie or session to
 * ride, CSRF is structurally impossible against the bearer-token API.
 *
 * @module @paw/daemon/security
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { LIVE_SUBPROTOCOL, MAX_PREAUTH_SESSIONS, MAX_SESSIONS } from '@paw/core';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Random bytes the session token carries. 256 bits: brute force over a loopback
 * socket is not a realistic threat.
 */
export const TOKEN_BYTES = 32;

/**
 * Loopback names a browser may use to reach this daemon.
 */
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '[::1]', '::1'];

/**
 * Compare presented token against real one. No leak, through timing, how much
 * of guess correct. Both sides hashed first so comparison over equal-length
 * digests — `timingSafeEqual` throw on length mismatch, that throw itself be
 * length oracle.
 *
 * @param {string} expected - Daemon's token.
 * @param {string | null | undefined} candidate - Caller presented this.
 * @returns {boolean} True when match.
 */
export function verifyToken(expected: string, candidate: string | null | undefined): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return false;
  }
  const a = createHash('sha256').update(expected, 'utf8').digest();
  const b = createHash('sha256').update(candidate, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/**
 * Take token from `Authorization` header. Null when header absent or not bearer
 * credential. Scheme matched case-insensitively, RFC 7235 require.
 *
 * @param {string | undefined} authorization - Raw header value.
 * @returns {string | null} Token, or null.
 */
export function bearerFrom(authorization: string | undefined): string | null {
  if (authorization === undefined) {
    return null;
  }
  const match = /^bearer[ ]+(\S+)$/i.exec(authorization.trim());
  return match === null ? null : match[1];
}

/**
 * Origins the daemon serves itself on. A browser treats the three loopback
 * spellings as three distinct origins, so all three are included.
 *
 * @param {number} port - Bound port.
 * @returns {string[]} Daemon's own origins.
 */
export function selfOrigins(port: number): string[] {
  return [`https://127.0.0.1:${port}`, `https://localhost:${port}`, `https://[::1]:${port}`];
}

/**
 * Normalise operator-supplied origin. Refuse anything that widens daemon
 * exposure: wildcard, scheme not http/https, bare hostname, and plain `http`
 * on anything but loopback, where traffic could be read or forged on the wire.
 * Loopback `http` origin allowed for a development server on the same machine.
 *
 * @param {string} value - The `--allow-origin` value.
 * @returns {string | null} Canonical origin, or null when refused.
 */
export function normaliseOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === 'https:') {
    return url.origin;
  }
  if (url.protocol !== 'http:') {
    return null;
  }
  return LOOPBACK_HOSTS.includes(url.hostname) ? url.origin : null;
}

/**
 * Origins request may claim, given port daemon bound and whatever operator
 * explicitly allow.
 *
 * @param {number} port - Bound port.
 * @param {readonly string[]} [allowed] - Operator-supplied origins.
 * @returns {string[]} Every acceptable origin, deduplicated.
 */
export function allowedOrigins(port: number, allowed: readonly string[] = []): string[] {
  const extra = allowed
    .map((value) => normaliseOrigin(value))
    .filter((origin): origin is string => origin !== null);
  return [...new Set([...selfOrigins(port), ...extra])];
}

/**
 * Whether request `Origin` may talk to daemon. Absent origin not browser — a
 * `curl` or CLI — pass this gate, face token gate instead; origin checks
 * restrain browsers, tokens restrain processes. Literal string `null`, what
 * `file://` page and sandboxed iframe send, always refused: unattributable by
 * construction.
 *
 * @param {string | undefined} origin - Request's `Origin` header.
 * @param {readonly string[]} allowed - Acceptable origins.
 * @returns {boolean} True when request may proceed.
 */
export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (origin === undefined) {
    return true;
  }
  if (origin === 'null') {
    return false;
  }
  return allowed.includes(origin);
}

/**
 * Whether request `Host` names this daemon. A rebinding page arrives with its
 * own name in `Host`; a console arrives with a loopback name and bound port.
 * Absent `Host` refused — HTTP/1.1 requires it, so absence means the request
 * carries no verifiable host.
 *
 * @param {string | undefined} host - Request's `Host` header.
 * @param {number} port - Bound port.
 * @returns {boolean} True when host name this daemon.
 */
export function hostAllowed(host: string | undefined, port: number): boolean {
  if (host === undefined || host === '') {
    return false;
  }
  const match = /^(\[[0-9a-fA-F:]+\]|[^:]+)(?::(\d+))?$/.exec(host.trim());
  if (match === null) {
    return false;
  }
  const [, hostname, portText] = match;
  if (!LOOPBACK_HOSTS.includes(hostname)) {
    return false;
  }
  return portText === undefined ? port === 443 : Number(portText) === port;
}

/**
 * CORS headers for request, none at all unless its origin on list. Credentials
 * never allowed: API authenticate with bearer token page hold in memory, so
 * nothing cross-origin request could ride in on.
 *
 * @param {string | undefined} origin - Request's `Origin` header.
 * @param {readonly string[]} allowed - Acceptable origins.
 * @returns {Record<string, string>} Headers to merge into response.
 */
export function corsHeadersFor(
  origin: string | undefined,
  allowed: readonly string[],
): Record<string, string> {
  if (origin === undefined || !allowed.includes(origin)) {
    return { vary: 'Origin' };
  }
  return {
    vary: 'Origin',
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
  };
}

/**
 * Headers every response carries. `Strict-Transport-Security` omitted: HSTS is
 * keyed by host across every port, so sending it for `localhost` forces https
 * onto every other development server on the operator machine, even though the
 * loopback socket is already TLS-only.
 *
 * @returns {Record<string, string>} Baseline headers.
 */
export function securityHeaders(): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
  };
}

/**
 * `'sha256-…'` CSP sources for every inline script in the page.
 *
 * Console is a single self-contained file with an inlined bundle, so scripts
 * are known when the daemon reads the page and never change while it runs.
 * Hashing them turns `script-src 'unsafe-inline'` — which permits any inline
 * script, including one injected through a rendering bug — into a grant naming
 * exactly the bundle that was built.
 *
 * Digest covers element text content exactly as the browser sees it. A script
 * with a `src` is skipped (no inline body) and nothing is trimmed: any changed
 * byte produces a different hash.
 *
 * @param {string} html - Page as it will be served.
 * @returns {string[]} Hash sources, in document order, deduplicated.
 */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const script = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(script)) {
    const body = match[1];
    if (body === '') {
      continue;
    }
    const digest = createHash('sha256').update(body, 'utf8').digest('base64');
    const source = `'sha256-${digest}'`;
    if (!hashes.includes(source)) {
      hashes.push(source);
    }
  }
  return hashes;
}

/**
 * Why upgrade refused, plain HTTP response.
 *
 * @interface UpgradeRefusal
 * @property {number} status - Status to answer with.
 * @property {string} message - Body, say what failed, nothing more.
 */
export interface UpgradeRefusal {
  readonly status: number;
  readonly message: string;
}

/**
 * What daemon know about socket asking to become WebSocket.
 *
 * @interface UpgradeRequest
 * @property {string} [host] - Request's `Host`.
 * @property {string} [origin] - Request's `Origin`.
 * @property {string[]} protocols - Subprotocols client offered.
 * @property {number} port - Bound port.
 * @property {string[]} origins - Acceptable origins.
 * @property {number} liveSessions - How many authenticated sessions open.
 * @property {number} preAuthSessions - How many sockets open but unauthenticated.
 */
export interface UpgradeRequest {
  readonly host: string | undefined;
  readonly origin: string | undefined;
  readonly protocols: readonly string[];
  readonly port: number;
  readonly origins: readonly string[];
  readonly liveSessions: number;
  readonly preAuthSessions: number;
}

/**
 * Whether the socket may upgrade, decided before any WebSocket state exists.
 *
 * Every refusal here is a plain HTTP response: a rejected upgrade costs the
 * daemon a socket close, an accepted one a session, timer, and buffer. Order —
 * identity of the request first (`Host`, then `Origin`, then subprotocol), then
 * daemon capacity — keeps a rebinding page told 400 whether or not the daemon
 * is busy, so the answer cannot become a probe.
 *
 * **No lockout after repeated failures.** On loopback the daemon cannot tell
 * one local peer from another, so a global cooldown would be a denial of
 * service any local process can trigger against the operator's own console.
 * Failures are counted and reported to the operator, not turned into a lock.
 *
 * Token **not** checked here. It arrives in the first frame after upgrade,
 * because the browser cannot set a header on the WebSocket handshake, and
 * putting the credential in the URL would write it into every log that records
 * the request line.
 *
 * @param {UpgradeRequest} request - What known about socket.
 * @returns {UpgradeRefusal | null} Refusal, or null when may proceed.
 */
export function decideUpgrade(request: UpgradeRequest): UpgradeRefusal | null {
  if (!hostAllowed(request.host, request.port)) {
    return { status: 400, message: 'bad host' };
  }
  if (!originAllowed(request.origin, request.origins)) {
    return { status: 403, message: 'origin not allowed' };
  }
  if (!request.protocols.includes(LIVE_SUBPROTOCOL)) {
    return { status: 400, message: `expected the ${LIVE_SUBPROTOCOL} subprotocol` };
  }
  if (request.liveSessions >= MAX_SESSIONS || request.preAuthSessions >= MAX_PREAUTH_SESSIONS) {
    return { status: 429, message: 'too many sessions' };
  }
  return null;
}

/**
 * Page Content-Security-Policy, built per boot because origin — and therefore
 * one `wss://` console may open — not known until daemon bind port. Everything
 * denied by default; console own inline bundle and single socket back to this
 * daemon be only grants.
 *
 * @param {number} port - Bound port.
 * @param {readonly string[]} [scriptHashes] - `'sha256-…'` sources for page's own inline scripts.
 * @returns {string} Policy.
 */
export function cspFor(port: number, scriptHashes: readonly string[] = []): string {
  const origins = selfOrigins(port);
  const connect = [...origins, ...origins.map((origin) => origin.replace('https://', 'wss://'))];
  // Hash source and `'unsafe-inline'` not additive: a browser that understands
  // hashes ignores `'unsafe-inline'` entirely. So listing the page's own
  // scripts by digest narrows the grant, and falls back to `'unsafe-inline'`
  // only when there is no script to hash at all.
  const script = scriptHashes.length === 0 ? "'unsafe-inline'" : scriptHashes.join(' ');
  return [
    "default-src 'none'",
    `script-src ${script}`,
    // Styles stay inline-permitted: the console injects a stylesheet from React
    // at runtime, so there is no static text to hash. A nonce would mean
    // rewriting the served HTML per boot; the exposure a nonce would close —
    // CSS-based exfiltration on a page whose only data source is this daemon —
    // does not justify mutating the artifact on every request.
    "style-src 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}
