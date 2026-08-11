/**
 * PAW Egress Logic
 *
 * @fileoverview Pure core of PAW daemon-owned BYOK egress. Copilot SDK lets consumer own outbound model call through `CopilotRequestHandler`; this is the logic that handler runs, factored out so it needs neither SDK nor network to test. It writes provider key onto outbound request (PAW adds the credential at the last hop, so it never travels in a config object nor reaches runtime), calls through injected fetch, and — only for a successful response tied to a session — reads token usage from the body and reports it, because the SDK shows no usage of its own. Non-2xx responses return untouched for the SDK to handle; usage is never read for them.
 *
 * @module @paw/daemon/model/pawEgressLogic
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { parseProviderUsage, type TokenUsage } from './providerUsage.js';

/**
 * Collaborators {@link handleEgress} takes as arguments; injected so the logic depends on none of them directly.
 *
 * @interface EgressDeps
 * @property {() => string | Promise<string>} authToken - Give provider bearer token at call time.
 * @property {(request: Request) => Promise<Response>} fetchImpl - Do upstream call.
 * @property {(sessionId: string, usage: TokenUsage) => void} onUsage - Record usage for done session request.
 * @property {(sessionId: string | undefined) => number | undefined} maxTokensFor - Output ceiling to write onto this session chat-completion body, or undefined to leave unbounded.
 */
export interface EgressDeps {
  readonly authToken: () => string | Promise<string>;
  readonly fetchImpl: (request: Request) => Promise<Response>;
  readonly onUsage: (sessionId: string, usage: TokenUsage) => void;
  readonly maxTokensFor: (sessionId: string | undefined) => number | undefined;
}

/**
 * Rebuild outbound request with auth header; write `max_tokens` onto chat-completion body when cap applies to this session. SDK forwards no `max_tokens` of its own, so this is the only place the provider learns the ceiling; non-completion body, non-JSON request, or absent cap pass through unchanged.
 *
 * @param {Request} request - Runtime outbound request.
 * @param {Headers} headers - Headers already carry provider key.
 * @param {number | undefined} cap - Output ceiling for this session, or undefined.
 * @returns {Promise<Request>} Request to send upstream.
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
 * Write provider key onto request, apply session output cap, do call, and report usage for successful session request.
 *
 * @param {Request} request - Outbound model-layer request runtime issued.
 * @param {string | undefined} sessionId - SDK session this request belong to, when known.
 * @param {EgressDeps} deps - Injected token source, fetch, usage sink, and cap source.
 * @returns {Promise<Response>} Provider response, returned to runtime unchanged.
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
