/**
 * PAW Copilot-SDK model adapter.
 *
 * @fileoverview {@link ModelPort} for PAW's GitHub Copilot SDK provider. The SDK work — spawn runtime, make BYOK session, send prompt, read usage — all run in the {@link SessionRun} the caller injects. This module maps a {@link ModelRequest} to that call and returns the result as {@link ModelResponse}. Replacing the provider needs a new `SessionRun` in this one file; `@paw/core` and its consumers are unchanged.
 *
 * @module @paw/adapters/model/copilotSdk
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ModelPort, ModelRequest, ModelResponse } from '@paw/core';

/**
 * Runs one completion and returns its content and token usage. Production
 * impl wraps `@github/copilot-sdk` (make a BYOK session, `sendAndWait`, read
 * `session.shutdown` usage); a fake impl does the same for tests. No other
 * PAW code references the SDK.
 *
 * @callback SessionRun
 * @param {ModelRequest} request - The completion to run.
 * @returns {Promise<{ content: string; inputTokens: number; outputTokens: number }>} The result.
 */
export type SessionRun = (
  request: ModelRequest,
) => Promise<{ content: string; inputTokens: number; outputTokens: number }>;

/**
 * Build Copilot-SDK-backed model port from injected session runner.
 *
 * @param {SessionRun} run - Runs completions for the model provider.
 * @returns {ModelPort} Model port that maps requests to responses.
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
