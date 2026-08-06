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
import {
  bearerFrom,
  corsHeadersFor,
  cspFor,
  hostAllowed,
  originAllowed,
  securityHeaders,
  verifyToken,
} from './security.js';
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
 */
export interface RequestHeaders {
  readonly authorization?: string;
  readonly origin?: string;
  readonly host?: string;
}

/**
 * One request, as the router sees it.
 *
 * @interface HttpRequest
 * @property {string} method - The HTTP method.
 * @property {string} path - The path, without the query string.
 * @property {URLSearchParams} [query] - The parsed query string.
 * @property {RequestHeaders} [headers] - The headers the router reads.
 */
export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly query?: URLSearchParams;
  readonly headers?: RequestHeaders;
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
 * @property {readonly string[]} origins - The origins allowed to call the API.
 */
export interface RouterDeps {
  readonly page: string;
  readonly snapshot: (plan?: string | null) => Promise<PawSnapshot>;
  readonly tree: () => readonly TreeNode[];
  readonly token: string;
  readonly port: number;
  readonly origins: readonly string[];
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
 * A JSON response, never cached — every read is of live state.
 *
 * @param {unknown} body - The value to serialise.
 * @param {Record<string, string>} cors - The CORS headers this request earned.
 * @returns {HttpResponse} The response.
 */
function json(body: unknown, cors: Record<string, string>): HttpResponse {
  return {
    status: 200,
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
 * Route a request to a response.
 *
 * @param {HttpRequest} request - The request.
 * @param {RouterDeps} deps - The page, snapshot, tree, and security policy.
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

  if (request.method !== 'GET') {
    return refuse(405, 'method not allowed', cors);
  }

  if (request.path === '/' || request.path === '/index.html') {
    return {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': cspFor(deps.port),
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
  }

  return refuse(404, 'not found', cors);
}
