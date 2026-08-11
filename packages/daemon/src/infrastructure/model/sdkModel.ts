/**
 * PAW SDK Model Shell
 *
 * @fileoverview Only file import `@github/copilot-sdk` and spawn runtime. The three unit-covered cores
 * ({@link handleEgress}, {@link createSdkSessionRun}, {@link parseProviderUsage})
 * together implement {@link ModelPort}. {@link PawEgress} request
 * handler stamps provider key on every outbound model call, and
 * reads token usage from response — so key never reach runtime and
 * SDK missing usage get recovered. Client start once and share
 * across run concurrent completions; `close` stop it. Exclude from unit
 * coverage in `vitest.config.ts` (need 159 MB runtime) and prove by
 * opt-in `PAW_SDK_LIVE` integration test.
 *
 * @module @paw/daemon/model/sdkModel
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { CopilotClient, CopilotRequestHandler, approveAll, type CopilotRequestContext } from '@github/copilot-sdk';
import { createCopilotSdkModel } from '@paw/adapters';
import type { ModelPort } from '@paw/core';
import { handleEgress, type EgressDeps } from './pawEgressLogic.js';
import { createSdkSessionRun, type ProviderBlock, type SdkClientLike } from './sdkSessionRun.js';
import type { TokenUsage } from './providerUsage.js';

/**
 * Request handler that PAW passes to runtime: every outbound model call routes
 * through {@link handleEgress}, so PAW adds key and reads usage itself.
 */
class PawEgress extends CopilotRequestHandler {
  readonly #deps: EgressDeps;

  /**
   * @param {EgressDeps} deps - Token source, fetch, usage sink.
   */
  constructor(deps: EgressDeps) {
    super();
    this.#deps = deps;
  }

  /**
   * @param {Request} request - Outbound model-layer request.
   * @param {CopilotRequestContext} ctx - Per-request context carry session id.
   * @returns {Promise<Response>} Provider response.
   */
  protected sendRequest(request: Request, ctx: CopilotRequestContext): Promise<Response> {
    return handleEgress(request, ctx.sessionId, this.#deps);
  }
}

/**
 * Options for {@link openSdkModel}.
 *
 * @interface OpenSdkModelOptions
 * @property {ProviderBlock} provider - BYOK provider target (type + baseUrl, no key).
 * @property {() => string | Promise<string>} authToken - Yield provider key at egress.
 * @property {string} baseDirectory - Where runtime write session state.
 * @property {string} workingDirectory - Absolute root member built-in file and shell tool operate within; served repository.
 * @property {boolean} safemode - When true, member deny shell — option-A surface.
 */
export interface OpenSdkModelOptions {
  readonly provider: ProviderBlock;
  readonly authToken: () => string | Promise<string>;
  readonly baseDirectory: string;
  readonly workingDirectory: string;
  readonly safemode: boolean;
}

/**
 * Start shared Copilot client for BYOK egress and return model port over it.
 *
 * @param {OpenSdkModelOptions} options - Provider, key source, runtime home.
 * @returns {Promise<{ port: ModelPort; close: () => Promise<void> }>} Port and stop hook.
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
    {
      workingDirectory: options.workingDirectory,
      safemode: options.safemode,
      onPermissionRequest: approveAll,
    },
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
