/**
 * PAW Daemon Router
 *
 * @fileoverview The daemon's request routing as a pure function of a request and
 * its dependencies: it serves the web UI page at `/`, the live
 * {@link PawSnapshot} as JSON at `/api/state`, the repository file tree at
 * `/api/tree`, and refuses everything else — with the reason, and with the
 * correct status. No socket, no streams; `nodeRuntime` wraps this in a TLS
 * server, but every decision, every header, and every refusal is made here and
 * unit-tested.
 *
 * The gates run before the routes and in a deliberate order, cheapest and
 * broadest first: `Host` (a rebinding page names itself, not us), `Origin` (a
 * page the operator has open may send requests to loopback), then the bearer
 * token (another process on the machine has no origin at all). The page itself
 * is ungated — it is the static bundle and carries no data — while everything
 * under `/api/` requires all three. The snapshot and the tree are provided as
 * thunks so each request re-reads them: the data is live, not a value frozen at
 * boot.
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
 * A routed HTTP response, ready for the runtime to write to a socket.
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
 * The headers the router reads. Everything else about the request is ignored,
 * which is itself a policy: nothing is routed on a header the daemon has not
 * declared an interest in.
 *
 * @interface RequestHeaders
 * @property {string} [authorization] - The bearer credential.
 * @property {string} [origin] - The requesting page's origin, when a browser sent it.
 * @property {string} [host] - The authority the client believes it reached.
 * @property {string} [contentType] - The body's media type, gated on writes.
 */
export interface RequestHeaders {
  readonly authorization?: string;
  readonly origin?: string;
  readonly host?: string;
  readonly contentType?: string;
}

/**
 * One request, as the router sees it.
 *
 * @interface HttpRequest
 * @property {string} method - The HTTP method.
 * @property {string} path - The path, without the query string.
 * @property {URLSearchParams} [query] - The parsed query string.
 * @property {RequestHeaders} [headers] - The headers the router reads.
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
 * The registry slice the config editor reads: the declared models and every
 * role's binding.
 *
 * @interface ConfigView
 * @property {string[]} models - The declared model ids.
 * @property {Record<string, string>} roles - Role id → model id bindings.
 */
export interface ConfigView {
  readonly models: readonly string[];
  readonly roles: Readonly<Record<string, string>>;
}

/**
 * What the router needs to answer a request.
 *
 * @interface RouterDeps
 * @property {string} page - The web UI HTML to serve at `/`.
 * @property {(plan: string | null) => Promise<PawSnapshot>} snapshot - Produces the current snapshot for a selected plan, per request.
 * @property {() => readonly TreeNode[]} tree - Produces the current repository file tree.
 * @property {string} token - The per-boot token every `/api/` request must present.
 * @property {number} port - The bound port, for the host gate and the page's CSP.
 * @property {readonly string[]} scriptHashes - CSP sources for the page's own inline scripts.
 * @property {readonly string[]} origins - The origins allowed to call the API.
 * @property {ControlPort} [control] - The writes this daemon exposes; absent leaves it observational.
 * @property {() => ConfigView} [config] - The declared models and role bindings, for the config editor.
 * @property {() => Promise<readonly string[]>} [recent] - The recently-grabbed routes, newest first, for the scope picker.
 */
export interface RouterDeps {
  readonly page: string;
  readonly snapshot: (plan?: string | null) => Promise<PawSnapshot>;
  readonly tree: () => readonly TreeNode[];
  readonly config?: () => ConfigView;
  readonly recent?: () => Promise<readonly string[]>;
  readonly token: string;
  readonly port: number;
  readonly scriptHashes: readonly string[];
  readonly origins: readonly string[];
  readonly control?: ControlPort;
}

/**
 * A plain-text refusal, carrying the baseline headers like every other response.
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
 * A JSON response, never cached — every read is of live state, and a write's
 * result is only ever true at the instant it is produced.
 *
 * @param {unknown} body - The value to serialise.
 * @param {Record<string, string>} cors - The CORS headers this request earned.
 * @param {number} [status] - The status code; 200 for a read.
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
 * Serve the live snapshot for the plan the request selected. A plan the
 * repository does not hold is a 404 with the reason, not a 500 and not a
 * silently empty console — the selection can only name what the daemon
 * discovered.
 *
 * @param {RouterDeps} deps - The snapshot provider.
 * @param {URLSearchParams | undefined} query - The request's query parameters.
 * @param {Record<string, string>} cors - The CORS headers this request earned.
 * @returns {Promise<HttpResponse>} The snapshot, or 404 for an unknown plan.
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
 * Serve the file tree, optionally narrowed to a directory within it.
 *
 * @param {RouterDeps} deps - The tree provider.
 * @param {URLSearchParams | undefined} query - The request's query parameters.
 * @param {Record<string, string>} cors - The CORS headers this request earned.
 * @returns {HttpResponse} The tree, or 404 when the requested root is not in it.
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
 * Answer a write — POST, PUT, or DELETE. Observational by default: a daemon with
 * no control port refuses every write with 405 and never looks at the credential,
 * which is the posture a read-only deployment keeps. With a control port, the same
 * gates a read faces apply (host already passed; origin, then token), the body is
 * sanitised, and the request is dispatched to the handler registered for its
 * method and path. An unknown route is a 404 raised *after* the token gate, so an
 * unauthenticated caller can neither drive a write nor map which writes exist.
 *
 * @param {HttpRequest} request - The request.
 * @param {RouterDeps} deps - The control port and security policy.
 * @param {RequestHeaders} headers - The request headers, already defaulted.
 * @param {Record<string, string>} cors - The CORS headers this request earned.
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
 * Route a request to a response.
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
