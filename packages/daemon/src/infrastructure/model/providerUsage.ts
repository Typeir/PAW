/**
 * PAW Provider Usage
 *
 * @fileoverview Reads token usage from raw provider completion response. Copilot SDK does not surface usage to the client — `sendAndWait` returns an assistant message without usage — so the PAW daemon reads usage from the provider response it receives when it makes the call through `CopilotRequestHandler`. A response with no usable usage makes the call throw; a zero default is not emitted, because it would understate spend and CONSTRAINTS.md Constraint 3 forbids it.
 *
 * @module @paw/daemon/model/providerUsage
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Token counts from one provider completion.
 *
 * @interface TokenUsage
 * @property {number} inputTokens - Tokens consumed by the prompt.
 * @property {number} outputTokens - Tokens produced in the completion.
 */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Reads a numeric field from an object, or `undefined` when the field is absent or not a number. A non-numeric token count is treated as missing and not coerced.
 *
 * @param {Record<string, unknown>} source - Object to read from.
 * @param {string} key - Field name.
 * @returns {number | undefined} The number, or undefined.
 */
function numberAt(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' ? value : undefined;
}

/**
 * Extracts `{ inputTokens, outputTokens }` from a provider response body, covering the OpenAI Chat Completions shape (`prompt_tokens` / `completion_tokens`) and the OpenAI Responses / Anthropic shape (`input_tokens` / `output_tokens`).
 *
 * @param {unknown} body - Parsed JSON response body.
 * @returns {TokenUsage} Extracted token counts.
 * @throws {Error} When the body carries no usage block or no recognisable token counts — the call throws; a zero default is not emitted.
 */
export function parseProviderUsage(body: unknown): TokenUsage {
  const usage = (body as { usage?: unknown } | null | undefined)?.usage;
  if (!usage || typeof usage !== 'object') {
    throw new Error('provider response carried no usage block; refusing to report 0 tokens');
  }
  const record = usage as Record<string, unknown>;
  const inputTokens = numberAt(record, 'input_tokens') ?? numberAt(record, 'prompt_tokens');
  const outputTokens = numberAt(record, 'output_tokens') ?? numberAt(record, 'completion_tokens');
  if (inputTokens === undefined || outputTokens === undefined) {
    throw new Error(`provider usage block missing token counts: ${JSON.stringify(usage)}`);
  }
  return { inputTokens, outputTokens };
}
