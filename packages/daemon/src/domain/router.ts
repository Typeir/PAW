/**
 * PAW Daemon Router
 *
 * @fileoverview Route request to response, pure function of request and deps.
 * Serve web UI page at `/`, live {@link PawSnapshot} as JSON at `/api/state`,
 * repo file tree at `/api/tree`, refuse all else with reason and status.
 * `nodeRuntime` wrap this in TLS server; every decision, header, refusal made
 * here and unit-tested.
 *
 * Gates run before routes. Cheapest and broadest first: `Host`, then `Origin`,
 * then bearer token. Page ungated, carry no data; everything under `/api/`
 * need all three. Snapshot and tree come as thunks, so each request re-read
 * live data.
 *
 * @module @paw/daemon/router
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { PawSnapshot, TreeNode } from '@paw/core';
import { UnknownPlanError } from './plans.js';
import { isWriteMethod, parseControlBody, type ControlPort } from './control.js';
import {
  bearerFrom,
  corsHeadersFor,
  cspFor,
  hostAllowed,
  originAllowed,
  securityHeaders,
  verifyToken,
} from '../infrastructure/security.js';
import { findSubtree } from './tree.js';

/**
 * Routed HTTP response. Ready for runtime to write to socket.
 *
 * @interface HttpResponse
 * @property {number} status - The HTTP status code.
 * @property {Record<string, string>} headers - Response headers.
 * @property {string} body - The response body.
 */
export interface HttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/**
 * Headers the router read. Ignore all other request headers.
 *
 * @interface RequestHeaders
 * @property {string} [authorization] - The bearer credential.
 * @property {string} [origin] - Requesting page's origin, when browser sent it.
 * @property {string} [host] - Authority client believe it reached.
 * @property {string} [contentType] - Body media type, gated on writes.
 */
export interface RequestHeaders {
  readonly authorization?: string;
  readonly origin?: string;
  readonly host?: string;
  readonly contentType?: string;
}

/**
 * One request, as router see it.
 *
 * @interface HttpRequest
 * @property {string} method - The HTTP method.
 * @property {string} path - The path, without query string.
 * @property {URLSearchParams} [query] - The parsed query string.
 * @property {RequestHeaders} [headers] - The headers router read.
 * @property {string} [body] - The raw request body, present on writes.
 */
export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly query?: URLSearchParams;
  readonly headers?: RequestHeaders;
  readonly body?: string;
}

/**
 * Registry slice config editor read: declared models and every role binding.
 *
 * @interface ConfigView
 * @property {string[]} models - Declared model ids.
 * @property {Record<string, string>} roles - Role id → model id bindings.
 */
export interface ConfigView {
  readonly models: readonly string[];
  readonly roles: Readonly<Record<string, string>>;
}

/**
 * What router need to answer request.
 *
 * @interface RouterDeps
 * @property {string} page - Web UI HTML to serve at `/`.
 * @property {(plan: string | null) => Promise<PawSnapshot>} snapshot - Produce current snapshot for selected plan, per request.
 * @property {() => readonly TreeNode[]} tree - Produce current repository file tree.
 * @property {string} token - Per-boot token every `/api/` request must present.
 * @property {number} port - Bound port, for host gate and page CSP.
 * @property {readonly string[]} scriptHashes - CSP sources for page's own inline scripts.
 * @property {readonly string[]} origins - Origins allowed to call API.
 * @property {ControlPort} [control] - Writes this daemon expose; absent leave it observational.
 * @property {() => ConfigView} [config] - Declared models and role bindings, for config editor.
 * @property {() => Promise<readonly string[]>} [recent] - Recently-grabbed routes, newest first, for scope picker.
 * @property {(route: string) => Promise<readonly string[]>} [forgetRecent] - Drop route from recent list, return new list. Daemon-own metadata, so it need no {@link ControlPort} — delete a stale entry never touch the consumer repo.
 * @property {(id: string, at: string, event: Record<string, unknown>) => boolean} [reportRun] - Fold one external-herd dispatch event into the run slice. Daemon-own display state, no {@link ControlPort}; false when the event does not fold.
 */
export interface RouterDeps {
  readonly page: string;
  readonly snapshot: (plan?: string | null) => Promise<PawSnapshot>;
  readonly tree: () => readonly TreeNode[];
  readonly config?: () => ConfigView;
  readonly recent?: () => Promise<readonly string[]>;
  readonly forgetRecent?: (route: string) => Promise<readonly string[]>;
  readonly reportRun?: (id: string, at: string, event: Record<string, unknown>) => boolean;
  readonly token: string;
  readonly port: number;
  readonly scriptHashes: readonly string[];
  readonly origins: readonly string[];
  readonly control?: ControlPort;
}

/**
 * Plain-text refusal. Carry baseline headers like every other response.
 *
 * @param {number} status - The status code.
 * @param {string} body - The reason.
 * @param {Record<string, string>} [extra] - Additional headers.
 * @returns {HttpResponse} The response.
 */
function refuse(
  status: number,
  body: string,
  extra: Record<string, string> = {},
): HttpResponse {
  return {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...securityHeaders(), ...extra },
    body,
  };
}

/**
 * JSON response. Never cached; reads of live state.
 *
 * @param {unknown} body - Value to serialise.
 * @param {Record<string, string>} cors - CORS headers this request earned.
 * @param {number} [status] - The status code; 200 for read.
 * @returns {HttpResponse} The response.
 */
function json(body: unknown, cors: Record<string, string>, status = 200): HttpResponse {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...securityHeaders(),
      ...cors,
    },
    body: JSON.stringify(body),
  };
}

/**
 * Serve live snapshot for plan request selected. Plan repo not hold returns
 * 404 with reason.
 *
 * @param {RouterDeps} deps - The snapshot provider.
 * @param {URLSearchParams | undefined} query - Request query parameters.
 * @param {Record<string, string>} cors - CORS headers this request earned.
 * @returns {Promise<HttpResponse>} The snapshot, or 404 for unknown plan.
 */
async function stateResponse(
  deps: RouterDeps,
  query: URLSearchParams | undefined,
  cors: Record<string, string>,
): Promise<HttpResponse> {
  const asked = query?.get('plan');
  try {
    return json(await deps.snapshot(asked ?? undefined), cors);
  } catch (err: unknown) {
    if (!(err instanceof UnknownPlanError)) {
      throw err;
    }
    return refuse(404, err.message, cors);
  }
}

/**
 * Serve file tree. Optionally narrow to directory within it.
 *
 * @param {RouterDeps} deps - The tree provider.
 * @param {URLSearchParams | undefined} query - Request query parameters.
 * @param {Record<string, string>} cors - CORS headers this request earned.
 * @returns {HttpResponse} The tree, or 404 when requested root not in it.
 */
function treeResponse(
  deps: RouterDeps,
  query: URLSearchParams | undefined,
  cors: Record<string, string>,
): HttpResponse {
  const root = query?.get('root') ?? '';
  if (root === '' || root === '.' || root === '/') {
    return json(deps.tree(), cors);
  }
  const narrowed = findSubtree(deps.tree(), root);
  if (narrowed === null) {
    return refuse(404, 'no such tree root', cors);
  }
  return json(narrowed, cors);
}

/**
 * Answer write — POST, PUT, or DELETE. Observational by default: daemon with
 * no control port refuse every write with 405 and never read credential. With
 * control port, read gates apply (host already passed; origin, then token),
 * body sanitised, request dispatched to handler registered for its method and
 * path. Unknown route return 404 after token gate.
 *
 * @param {HttpRequest} request - The request.
 * @param {RouterDeps} deps - The control port and security policy.
 * @param {RequestHeaders} headers - Request headers, already defaulted.
 * @param {Record<string, string>} cors - CORS headers this request earned.
 * @returns {Promise<HttpResponse>} The response.
 */
async function writeResponse(
  request: HttpRequest,
  deps: RouterDeps,
  headers: RequestHeaders,
  cors: Record<string, string>,
): Promise<HttpResponse> {
  if (deps.control === undefined) {
    return refuse(405, 'method not allowed', cors);
  }
  if (!request.path.startsWith('/api/')) {
    return refuse(404, 'not found', cors);
  }
  if (!originAllowed(headers.origin, deps.origins)) {
    return refuse(403, 'origin not allowed', cors);
  }
  if (!verifyToken(deps.token, bearerFrom(headers.authorization))) {
    return refuse(401, 'unauthorized', { ...cors, 'www-authenticate': 'Bearer realm="pawd"' });
  }
  const parsed = parseControlBody(request.body ?? '', headers.contentType);
  if (!parsed.ok) {
    return refuse(parsed.status, parsed.message, cors);
  }
  const handler = deps.control.handlers[`${request.method} ${request.path}`];
  if (handler === undefined) {
    return refuse(404, 'not found', cors);
  }
  const result = await handler({ query: request.query, body: parsed.body });
  return json(result.body, cors, result.status);
}

/**
 * Route request to response.
 *
 * @param {HttpRequest} request - The request.
 * @param {RouterDeps} deps - The page, snapshot, tree, control port, and security policy.
 * @returns {Promise<HttpResponse>} The response to write.
 */
export async function route(request: HttpRequest, deps: RouterDeps): Promise<HttpResponse> {
  const headers = request.headers ?? {};
  const cors = corsHeadersFor(headers.origin, deps.origins);

  if (!hostAllowed(headers.host, deps.port)) {
    return refuse(400, 'bad host');
  }

  const isApi = request.path.startsWith('/api/');

  if (request.method === 'OPTIONS') {
    if (!isApi || !originAllowed(headers.origin, deps.origins)) {
      return refuse(403, 'origin not allowed', cors);
    }
    return { status: 204, headers: { ...securityHeaders(), ...cors }, body: '' };
  }

  if (request.method === 'DELETE' && request.path === '/api/recent') {
    if (!originAllowed(headers.origin, deps.origins)) {
      return refuse(403, 'origin not allowed', cors);
    }
    if (!verifyToken(deps.token, bearerFrom(headers.authorization))) {
      return refuse(401, 'unauthorized', {
        ...cors,
        'www-authenticate': 'Bearer realm="pawd"',
      });
    }
    const target = request.query?.get('route') ?? '';
    if (deps.forgetRecent === undefined || target === '') {
      return refuse(404, 'not found', cors);
    }
    return json(await deps.forgetRecent(target), cors);
  }

  if (request.method === 'POST' && request.path === '/api/run/report') {
    if (!originAllowed(headers.origin, deps.origins)) {
      return refuse(403, 'origin not allowed', cors);
    }
    if (!verifyToken(deps.token, bearerFrom(headers.authorization))) {
      return refuse(401, 'unauthorized', {
        ...cors,
        'www-authenticate': 'Bearer realm="pawd"',
      });
    }
    if (deps.reportRun === undefined) {
      return refuse(404, 'not found', cors);
    }
    const parsed = parseControlBody(request.body ?? '', headers.contentType);
    if (!parsed.ok) {
      return refuse(parsed.status, parsed.message, cors);
    }
    const { id, at, event } = parsed.body;
    if (
      typeof id !== 'string' ||
      typeof at !== 'string' ||
      typeof event !== 'object' ||
      event === null ||
      Array.isArray(event)
    ) {
      return refuse(422, 'id, at, and event are required', cors);
    }
    if (!deps.reportRun(id, at, event as Record<string, unknown>)) {
      return refuse(422, 'event did not fold', cors);
    }
    return json({ ok: true }, cors);
  }

  if (isWriteMethod(request.method)) {
    return writeResponse(request, deps, headers, cors);
  }

  if (request.method !== 'GET') {
    return refuse(405, 'method not allowed', cors);
  }

  if (request.path === '/' || request.path === '/index.html') {
    return {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': cspFor(deps.port, deps.scriptHashes),
        ...securityHeaders(),
      },
      body: deps.page,
    };
  }

  if (isApi) {
    if (!originAllowed(headers.origin, deps.origins)) {
      return refuse(403, 'origin not allowed', cors);
    }
    if (!verifyToken(deps.token, bearerFrom(headers.authorization))) {
      return refuse(401, 'unauthorized', {
        ...cors,
        'www-authenticate': 'Bearer realm="pawd"',
      });
    }
    if (request.path === '/api/state') {
      return stateResponse(deps, request.query, cors);
    }
    if (request.path === '/api/tree') {
      return treeResponse(deps, request.query, cors);
    }
    if (request.path === '/api/config' && deps.config !== undefined) {
      return json(deps.config(), cors);
    }
    if (request.path === '/api/recent') {
      return json(deps.recent === undefined ? [] : await deps.recent(), cors);
    }
  }

  return refuse(404, 'not found', cors);
}
