/**
 * PAW Daemon Security Policy
 *
 * @fileoverview Who may talk to the daemon, and what it says back. Every rule
 * here is a pure function over strings, so the policy that guards a local
 * control API — which reports the operator's host, process table, repository
 * tree and briefs — is decided in unit tests rather than inside a socket
 * callback nobody can reach.
 *
 * Three gates, and they answer different attackers. The **token** stops another
 * process on the machine: 256 bits, minted per boot, compared in constant time.
 * The **origin** allow-list stops a web page the operator happens to have open,
 * which can send requests to loopback and can open WebSockets (the handshake is
 * exempt from CORS entirely). The **host** allow-list stops DNS rebinding, where
 * a page re-points its own name at 127.0.0.1 and inherits the daemon's origin.
 * TLS makes rebinding fail at the handshake as well; this is the belt behind
 * that brace.
 *
 * CORS here is a deny-by-default: the daemon emits no
 * `Access-Control-Allow-Origin` at all unless the request's origin is on the
 * list, and never emits `Access-Control-Allow-Credentials` — there is no cookie
 * or session to ride, which is what makes CSRF structurally impossible against
 * a bearer-token API.
 *
 * @module @paw/daemon/security
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * How many random bytes a session token carries. 256 bits: brute force over a
 * loopback socket is not a threat model, it is a joke.
 */
export const TOKEN_BYTES = 32;

/**
 * The loopback names a browser may legitimately reach this daemon by.
 */
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '[::1]', '::1'];

/**
 * Compare a presented token against the real one without leaking, through
 * timing, how much of a guess was correct. Both sides are hashed first so the
 * comparison is over equal-length digests — `timingSafeEqual` throws on a length
 * mismatch, and that throw would itself be a length oracle.
 *
 * @param {string} expected - The daemon's token.
 * @param {string | null | undefined} candidate - What the caller presented.
 * @returns {boolean} True when they match.
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
 * The token out of an `Authorization` header, or null when the header is absent
 * or is not a bearer credential. The scheme is matched case-insensitively, as
 * RFC 7235 requires.
 *
 * @param {string | undefined} authorization - The raw header value.
 * @returns {string | null} The token, or null.
 */
export function bearerFrom(authorization: string | undefined): string | null {
  if (authorization === undefined) {
    return null;
  }
  const match = /^bearer[ ]+(\S+)$/i.exec(authorization.trim());
  return match === null ? null : match[1];
}

/**
 * The origins the daemon serves itself on. A browser may spell loopback three
 * ways and each is a distinct origin, so all three are trusted equally.
 *
 * @param {number} port - The bound port.
 * @returns {string[]} The daemon's own origins.
 */
export function selfOrigins(port: number): string[] {
  return [`https://127.0.0.1:${port}`, `https://localhost:${port}`, `https://[::1]:${port}`];
}

/**
 * Normalise an operator-supplied origin, refusing anything that would widen the
 * daemon's exposure: a wildcard, a scheme that is not http/https, a bare
 * hostname, and — the important one — plain `http` on anything but loopback,
 * where the traffic could be read or forged on the wire. A loopback `http`
 * origin is allowed because that is a development server on the same machine,
 * which is the real reason this flag exists.
 *
 * @param {string} value - The `--allow-origin` value.
 * @returns {string | null} The canonical origin, or null when it is refused.
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
 * The origins a request may claim, given the port the daemon bound and whatever
 * the operator explicitly allowed.
 *
 * @param {number} port - The bound port.
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
 * Whether a request's `Origin` may talk to the daemon. An absent origin is not a
 * browser — a `curl` or the CLI — and passes this gate to face the token gate
 * instead; origin checks restrain browsers, tokens restrain processes. The
 * literal string `null`, which is what a `file://` page and a sandboxed iframe
 * send, is always refused: it is unattributable by construction.
 *
 * @param {string | undefined} origin - The request's `Origin` header.
 * @param {readonly string[]} allowed - The acceptable origins.
 * @returns {boolean} True when the request may proceed.
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
 * Whether a request's `Host` names this daemon. A rebinding page arrives with
 * its own name in `Host`; a legitimate console arrives with a loopback name and
 * the bound port. An absent `Host` is refused — HTTP/1.1 requires it, and its
 * absence means the request was not shaped by a browser or by anything that
 * should be trusted with this API.
 *
 * @param {string | undefined} host - The request's `Host` header.
 * @param {number} port - The bound port.
 * @returns {boolean} True when the host names this daemon.
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
 * The CORS headers for a request, which are none at all unless its origin is on
 * the list. Credentials are never allowed: the API authenticates with a bearer
 * token the page holds in memory, so there is nothing a cross-origin request
 * could ride in on.
 *
 * @param {string | undefined} origin - The request's `Origin` header.
 * @param {readonly string[]} allowed - The acceptable origins.
 * @returns {Record<string, string>} The headers to merge into the response.
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
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'authorization',
    'access-control-max-age': '600',
  };
}

/**
 * The headers every response carries, whatever it is. `Strict-Transport-Security`
 * is deliberately absent: HSTS is keyed by host across every port, so sending it
 * for `localhost` would force https onto every other development server on the
 * operator's machine — a footgun aimed at the whole workstation to protect a
 * loopback socket that is already TLS-only.
 *
 * @returns {Record<string, string>} The baseline headers.
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
 * The page's Content-Security-Policy, built per boot because the origin — and
 * therefore the one `wss://` the console may open — is not known until the
 * daemon binds a port. Everything is denied by default; the console's own
 * inline bundle and its single socket back to this daemon are the only grants.
 *
 * @param {number} port - The bound port.
 * @returns {string} The policy.
 */
export function cspFor(port: number): string {
  const origins = selfOrigins(port);
  const connect = [...origins, ...origins.map((origin) => origin.replace('https://', 'wss://'))];
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
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
