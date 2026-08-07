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
 */
export interface EgressDeps {
  readonly authToken: () => string | Promise<string>;
  readonly fetchImpl: (request: Request) => Promise<Response>;
  readonly onUsage: (sessionId: string, usage: TokenUsage) => void;
}

/**
 * Stamp the provider key onto the request, perform the call, and report usage for
 * a successful session request.
 *
 * @param {Request} request - The outbound model-layer request the runtime issued.
 * @param {string | undefined} sessionId - The SDK session this request belongs to, when known.
 * @param {EgressDeps} deps - Injected token source, fetch, and usage sink.
 * @returns {Promise<Response>} The provider response, returned to the runtime unchanged.
 */
export async function handleEgress(
  request: Request,
  sessionId: string | undefined,
  deps: EgressDeps,
): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${await deps.authToken()}`);
  const response = await deps.fetchImpl(new Request(request, { headers }));
  if (response.ok && sessionId !== undefined) {
    deps.onUsage(sessionId, parseProviderUsage(await response.clone().json()));
  }
  return response;
}
