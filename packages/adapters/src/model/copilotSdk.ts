/**
 * PAW Copilot-SDK Model Adapter
 *
 * @fileoverview The {@link ModelPort} implementation for our main herder
 * provider, the GitHub Copilot SDK — deliberately behind a one-function seam.
 * The SDK-specific work (spawning the runtime, creating a BYOK session, sending
 * a prompt, reading usage) is a {@link SessionRun} the caller injects; this
 * module only maps a {@link ModelRequest} to that call and its result back to a
 * {@link ModelResponse}. So the SDK lives in exactly one thin wiring function,
 * not smeared through the codebase: changing herder provider — or dropping the
 * SDK for a direct OpenAI-compatible client — is a different `SessionRun`, one
 * file, with `@paw/core` and every consumer untouched. Decoupled now, while the
 * surface is small, per the design intent, not at fifty times the size.
 *
 * @module @paw/adapters/model/copilotSdk
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ModelPort, ModelRequest, ModelResponse } from '@paw/core';

/**
 * The provider boundary: run one completion and return its content and token
 * usage. The real implementation wraps `@github/copilot-sdk` (create a BYOK
 * session, `sendAndWait`, read `session.shutdown` usage); a fake implements it
 * for tests. Nothing else in PAW knows the SDK exists.
 *
 * @callback SessionRun
 * @param {ModelRequest} request - The completion to run.
 * @returns {Promise<{ content: string; inputTokens: number; outputTokens: number }>} The result.
 */
export type SessionRun = (
  request: ModelRequest,
) => Promise<{ content: string; inputTokens: number; outputTokens: number }>;

/**
 * Create a Copilot-SDK-backed model port from an injected session runner.
 *
 * @param {SessionRun} run - The provider boundary that actually runs completions.
 * @returns {ModelPort} A model port that maps requests and responses.
 */
export function createCopilotSdkModel(run: SessionRun): ModelPort {
  return {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const result = await run(request);
      return {
        content: result.content,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      };
    },
  };
}
