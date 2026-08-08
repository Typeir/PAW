/**
 * PAW SDK Model Shell
 *
 * @fileoverview The one file in the repository that imports `@github/copilot-sdk`
 * and spawns its runtime — the thin shell that turns the three unit-covered cores
 * ({@link handleEgress}, {@link createSdkSessionRun}, {@link parseProviderUsage})
 * into a live {@link ModelPort}. PAW owns egress: a {@link PawEgress} request
 * handler stamps the provider key onto every outbound model call, performs it, and
 * reads token usage from the response — so the key never reaches the runtime and
 * the SDK's missing usage is recovered. The client is started once and shared
 * across a run's concurrent completions; `close` stops it. Excluded from unit
 * coverage in `vitest.config.ts` (it needs the 159 MB runtime) and proven by the
 * opt-in `PAW_SDK_LIVE` integration test.
 *
 * @module @paw/daemon/model/sdkModel
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { CopilotClient, CopilotRequestHandler, type CopilotRequestContext } from '@github/copilot-sdk';
import { createCopilotSdkModel } from '@paw/adapters';
import type { ModelPort } from '@paw/core';
import { handleEgress, type EgressDeps } from './pawEgressLogic.js';
import { createSdkSessionRun, type ProviderBlock, type SdkClientLike } from './sdkSessionRun.js';
import type { TokenUsage } from './providerUsage.js';

/**
 * The request handler PAW hands the runtime: every outbound model call is routed
 * through {@link handleEgress}, so PAW adds the key and reads usage itself.
 */
class PawEgress extends CopilotRequestHandler {
  readonly #deps: EgressDeps;

  /**
   * @param {EgressDeps} deps - Token source, fetch, and usage sink.
   */
  constructor(deps: EgressDeps) {
    super();
    this.#deps = deps;
  }

  /**
   * @param {Request} request - The outbound model-layer request.
   * @param {CopilotRequestContext} ctx - The per-request context carrying the session id.
   * @returns {Promise<Response>} The provider response.
   */
  protected sendRequest(request: Request, ctx: CopilotRequestContext): Promise<Response> {
    return handleEgress(request, ctx.sessionId, this.#deps);
  }
}

/**
 * Options for {@link openSdkModel}.
 *
 * @interface OpenSdkModelOptions
 * @property {ProviderBlock} provider - The BYOK provider target (type + baseUrl, no key).
 * @property {() => string | Promise<string>} authToken - Yields the provider key at egress.
 * @property {string} baseDirectory - Where the runtime writes its session state.
 */
export interface OpenSdkModelOptions {
  readonly provider: ProviderBlock;
  readonly authToken: () => string | Promise<string>;
  readonly baseDirectory: string;
}

/**
 * Start a shared Copilot client for BYOK egress and return a model port over it.
 *
 * @param {OpenSdkModelOptions} options - Provider, key source, and runtime home.
 * @returns {Promise<{ port: ModelPort; close: () => Promise<void> }>} The port and a stop hook.
 */
export async function openSdkModel(
  options: OpenSdkModelOptions,
): Promise<{ port: ModelPort; close: () => Promise<void> }> {
  const usageBySession = new Map<string, TokenUsage>();
  const maxTokensBySession = new Map<string, number>();
  const egress = new PawEgress({
    authToken: options.authToken,
    fetchImpl: (request) => fetch(request),
    onUsage: (sessionId, usage) => {
      usageBySession.set(sessionId, usage);
    },
    maxTokensFor: (sessionId) => (sessionId === undefined ? undefined : maxTokensBySession.get(sessionId)),
  });
  const client = new CopilotClient({
    requestHandler: egress,
    useLoggedInUser: false,
    mode: 'empty',
    baseDirectory: options.baseDirectory,
    logLevel: 'error',
  });
  await client.start();
  const run = createSdkSessionRun(
    client as unknown as SdkClientLike,
    options.provider,
    usageBySession,
    maxTokensBySession,
  );
  return {
    port: createCopilotSdkModel(run),
    close: async () => {
      const errors = await client.stop();
      if (errors.length > 0) {
        throw new Error(
          `copilot client shutdown reported ${errors.length} error(s): ${errors.map((error) => error.message).join('; ')}`,
        );
      }
    },
  };
}
