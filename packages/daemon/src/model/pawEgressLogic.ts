/**
 * PAW Egress Logic
 *
 * @fileoverview The pure core of PAW's daemon-owned BYOK egress. The Copilot SDK
 * lets a consumer own the outbound model call through a `CopilotRequestHandler`;
 * this is the logic that handler runs, factored out so it needs neither the SDK
 * nor the network to test. It stamps the provider key onto the outbound request
 * (so the credential is added by PAW at the last hop and never travels in a
 * config object or reaches the runtime), performs the call through an injected
 * fetch, and — only for a successful response attributed to a session — reads
 * token usage from the body and reports it, because the SDK surfaces no usage of
 * its own. A non-2xx response is returned untouched for the SDK to handle; usage
 * is never invented for it.
 *
 * @module @paw/daemon/model/pawEgressLogic
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { parseProviderUsage, type TokenUsage } from './providerUsage.js';

/**
 * The collaborators {@link handleEgress} needs, injected so the logic is pure.
 *
 * @interface EgressDeps
 * @property {() => string | Promise<string>} authToken - Yields the provider bearer token at call time.
 * @property {(request: Request) => Promise<Response>} fetchImpl - Performs the upstream call.
 * @property {(sessionId: string, usage: TokenUsage) => void} onUsage - Records usage for a completed session request.
 * @property {(sessionId: string | undefined) => number | undefined} maxTokensFor - The output ceiling to stamp onto this session's chat-completion body, or undefined to leave it unbounded.
 */
export interface EgressDeps {
  readonly authToken: () => string | Promise<string>;
  readonly fetchImpl: (request: Request) => Promise<Response>;
  readonly onUsage: (sessionId: string, usage: TokenUsage) => void;
  readonly maxTokensFor: (sessionId: string | undefined) => number | undefined;
}

/**
 * Rebuild the outbound request with the auth header, stamping `max_tokens` onto a
 * chat-completion body when a cap applies to this session. The SDK forwards no
 * `max_tokens` of its own, so this is the only place the provider learns the
 * ceiling; a non-completion body, a non-JSON request, or an absent cap passes
 * through unchanged.
 *
 * @param {Request} request - The runtime's outbound request.
 * @param {Headers} headers - Headers already carrying the provider key.
 * @param {number | undefined} cap - The output ceiling for this session, or undefined.
 * @returns {Promise<Request>} The request to send upstream.
 */
async function capRequest(request: Request, headers: Headers, cap: number | undefined): Promise<Request> {
  const isJsonPost =
    request.method === 'POST' && (request.headers.get('content-type') ?? '').includes('application/json');
  if (cap === undefined || !isJsonPost) {
    return new Request(request, { headers });
  }
  const payload = (await request.json()) as Record<string, unknown>;
  if (Array.isArray(payload.messages)) {
    payload.max_tokens = cap;
  }
  return new Request(request.url, { method: 'POST', headers, body: JSON.stringify(payload) });
}

/**
 * Stamp the provider key onto the request, apply the session's output cap,
 * perform the call, and report usage for a successful session request.
 *
 * @param {Request} request - The outbound model-layer request the runtime issued.
 * @param {string | undefined} sessionId - The SDK session this request belongs to, when known.
 * @param {EgressDeps} deps - Injected token source, fetch, usage sink, and cap source.
 * @returns {Promise<Response>} The provider response, returned to the runtime unchanged.
 */
export async function handleEgress(
  request: Request,
  sessionId: string | undefined,
  deps: EgressDeps,
): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${await deps.authToken()}`);
  const response = await deps.fetchImpl(await capRequest(request, headers, deps.maxTokensFor(sessionId)));
  if (response.ok && sessionId !== undefined) {
    deps.onUsage(sessionId, parseProviderUsage(await response.clone().json()));
  }
  return response;
}
