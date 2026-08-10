/**
 * PAW Daemon Control Port
 *
 * @fileoverview The write half of the daemon's HTTP surface. Reads are safe by
 * construction — idempotent, cacheable, no side effect — so they need no gate
 * beyond the token; a write changes state, spends, or stops something, so it gets
 * a narrower door. This module is that door as pure functions: which methods are
 * writes, how a request body is sanitised before any handler sees it, and the
 * shape of the {@link ControlPort} a handler registers against.
 *
 * The port is injected, and optional: a daemon composed without one answers 405
 * to every write and stays observational, which is the default a read-only
 * deployment keeps. Handlers are keyed by `"<METHOD> <path>"` so adding a verb is
 * adding a table entry, and every write flows through the one audited pipeline in
 * the router rather than growing a parallel path per verb.
 *
 * Body sanitisation is deliberately strict. A write must declare
 * `application/json`: `PUT` and `DELETE` are not CORS-safelisted so a browser
 * always preflights them, and requiring JSON forces the same preflight on `POST`,
 * the one write a page could otherwise send cross-origin as a "simple" request.
 * The token still gates every write regardless — this is the belt behind that
 * brace. An empty body is the empty object; anything that is not a JSON object
 * (a primitive, an array, `null`, malformed text) is refused before dispatch, so
 * a handler only ever receives a bag of named parameters.
 *
 * @module @paw/daemon/control
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * The HTTP methods this daemon treats as writes: they pass through the control
 * pipeline rather than the read routes, and the server reads a body for them.
 */
export const WRITE_METHODS: readonly string[] = ['POST', 'PUT', 'DELETE'];

/**
 * The largest control body the server will buffer, in bytes. Control commands are
 * a method name and a few parameters; 64 KiB is already orders of magnitude more
 * than any of them needs, and the cap is what stops a peer from making the daemon
 * hold an unbounded body in memory.
 */
export const CONTROL_BODY_CAP = 64 * 1024;

/**
 * Whether a method is a write, and so flows through the control pipeline.
 *
 * @param {string} method - The HTTP method.
 * @returns {boolean} True for POST, PUT, or DELETE.
 */
export function isWriteMethod(method: string): boolean {
  return WRITE_METHODS.includes(method);
}

/**
 * What a control handler is handed: the request's query parameters and its
 * sanitised body, already proven to be a JSON object.
 *
 * @interface ControlRequest
 * @property {URLSearchParams | undefined} query - The parsed query string.
 * @property {Record<string, unknown>} body - The sanitised JSON body.
 */
export interface ControlRequest {
  readonly query: URLSearchParams | undefined;
  readonly body: Record<string, unknown>;
}

/**
 * What a control handler returns: an HTTP status and a JSON-serialisable body.
 * A handler reports its own refusals here — a 422 for a bad parameter — while the
 * transport-level refusals (auth, content type, unknown route) are the router's.
 *
 * @interface ControlResult
 * @property {number} status - The HTTP status to answer with.
 * @property {unknown} body - The JSON-serialisable response body.
 */
export interface ControlResult {
  readonly status: number;
  readonly body: unknown;
}

/**
 * One registered write. Pure from the router's view — any effect it performs
 * lives inside it, exactly as the snapshot and tree thunks do for reads.
 *
 * @callback ControlHandler
 * @param {ControlRequest} request - The query and sanitised body.
 * @returns {Promise<ControlResult>} The status and body to answer with.
 */
export type ControlHandler = (request: ControlRequest) => Promise<ControlResult>;

/**
 * The set of writes a daemon exposes, keyed by `"<METHOD> <path>"`.
 *
 * @interface ControlPort
 * @property {Readonly<Record<string, ControlHandler>>} handlers - The registered writes.
 */
export interface ControlPort {
  readonly handlers: Readonly<Record<string, ControlHandler>>;
}

/**
 * Combine control ports into one, later handlers winning a shared key.
 *
 * @param {...ControlPort} ports - The ports to merge.
 * @returns {ControlPort} The combined port.
 */
export function mergeControl(...ports: readonly ControlPort[]): ControlPort {
  return { handlers: Object.assign({}, ...ports.map((port) => port.handlers)) };
}

/**
 * The outcome of sanitising a request body: the parsed object, or a refusal with
 * the status and reason the router should answer.
 */
export type BodyParse =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly status: number; readonly message: string };

/**
 * Whether a `Content-Type` names JSON, tolerating a charset or other parameter
 * after it (`application/json; charset=utf-8`) but nothing else.
 *
 * @param {string | undefined} contentType - The request's `Content-Type`.
 * @returns {boolean} True when the type is `application/json`.
 */
function isJsonContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) {
    return false;
  }
  return /^application\/json\s*(?:;.*)?$/i.test(contentType.trim());
}

/**
 * Sanitise a write's raw body into a bag of named parameters, or a refusal. An
 * empty body is the empty object — a `DELETE` that carries its parameters in the
 * query sends no body and no content type, and must not be refused for it. A
 * *non-empty* body must declare JSON (415), which is what forces a preflight on a
 * cross-origin `POST` that tries to smuggle one in; text that does not parse is
 * refused (400); a value that parses but is not a JSON object — a primitive, an
 * array, `null` — is refused (422). A handler downstream never has to defend
 * against anything but an object.
 *
 * @param {string} raw - The raw request body.
 * @param {string | undefined} contentType - The request's `Content-Type`.
 * @returns {BodyParse} The parsed object or a typed refusal.
 */
export function parseControlBody(raw: string, contentType: string | undefined): BodyParse {
  const text = raw.trim();
  if (text === '') {
    return { ok: true, body: {} };
  }
  if (!isJsonContentType(contentType)) {
    return { ok: false, status: 415, message: 'content-type must be application/json' };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, status: 400, message: 'malformed json' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, status: 422, message: 'body must be a json object' };
  }
  return { ok: true, body: value as Record<string, unknown> };
}
