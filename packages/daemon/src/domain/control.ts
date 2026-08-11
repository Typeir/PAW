/**
 * PAW Daemon Control Port
 *
 * @fileoverview Write half of daemon HTTP surface. Write change state, so it pass
 * gate beyond token. Give pure functions: what methods be writes, how request body
 * get sanitised before handler see it, and shape of {@link ControlPort} handler
 * register against.
 *
 * Port injected and optional. Daemon with no port answer 405 to every write and
 * stay observational, default read-only. Handler keyed by `"<METHOD> <path>"`;
 * add verb, add table entry. Every write flow through router's one audited
 * pipeline.
 *
 * Body sanitisation strict. Write must declare `application/json`. `PUT` and
 * `DELETE` no CORS-safelist, so browser always preflight them; require JSON force
 * same preflight on `POST`. Token gate every write. Empty body be empty object;
 * anything no JSON object — primitive, array, `null`, malformed text — refused
 * before dispatch. Handler get only bag of named parameters.
 *
 * @module @paw/daemon/control
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * HTTP methods daemon treat as writes. They pass through control pipeline, not
 * read routes. Server read body for them.
 */
export const WRITE_METHODS: readonly string[] = ['POST', 'PUT', 'DELETE'];

/**
 * Largest control body server buffer, in bytes. Control command be method name
 * and few parameters. Cap stop peer make daemon hold unbounded body in memory.
 */
export const CONTROL_BODY_CAP = 64 * 1024;

/**
 * Whether method be write, so flow through control pipeline.
 *
 * @param {string} method - The HTTP method.
 * @returns {boolean} True for POST, PUT, or DELETE.
 */
export function isWriteMethod(method: string): boolean {
  return WRITE_METHODS.includes(method);
}

/**
 * What control handler get handed: request query parameters and sanitised body,
 * already proven to be JSON object.
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
 * What control handler return: HTTP status and JSON-serialisable body. Handler
 * report own refusal here — 422 for bad parameter — while transport-level refusal
 * (auth, content type, unknown route) be router's.
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
 * One registered write. Pure from router view — any effect live inside it.
 *
 * @callback ControlHandler
 * @param {ControlRequest} request - The query and sanitised body.
 * @returns {Promise<ControlResult>} The status and body to answer with.
 */
export type ControlHandler = (request: ControlRequest) => Promise<ControlResult>;

/**
 * Set of write daemon expose, keyed by `"<METHOD> <path>"`.
 *
 * @interface ControlPort
 * @property {Readonly<Record<string, ControlHandler>>} handlers - The registered writes.
 */
export interface ControlPort {
  readonly handlers: Readonly<Record<string, ControlHandler>>;
}

/**
 * Combine control port into one, later handler win shared key.
 *
 * @param {...ControlPort} ports - The ports to merge.
 * @returns {ControlPort} The combined port.
 */
export function mergeControl(...ports: readonly ControlPort[]): ControlPort {
  return { handlers: Object.assign({}, ...ports.map((port) => port.handlers)) };
}

/**
 * Outcome of sanitising request body: parsed object, or refusal with status and
 * reason router should answer.
 */
export type BodyParse =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly status: number; readonly message: string };

/**
 * Whether `Content-Type` name JSON, tolerate charset or other parameter after it
 * (`application/json; charset=utf-8`) but nothing else.
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
 * Sanitise write raw body into bag of named parameter, or refusal. Empty body be
 * empty object — `DELETE` that carry parameter in query send no body and no
 * content type, must not get refused for it. *Non-empty* body must declare JSON
 * (415), which forces a preflight on cross-origin `POST` that sends a body;
 * text that no parse get refused (400); value that parse but no JSON object
 * — primitive, array, `null` — get refused (422). Handler downstream never got
 * defend against anything but object.
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
