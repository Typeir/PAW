/**
 * PAW Provider Usage
 *
 * @fileoverview Extracts token usage from a raw provider completion response.
 * The Copilot SDK does not surface token usage to its client (`sendAndWait`
 * returns an assistant message with no usage), so PAW's daemon-owned egress reads
 * usage from the provider response itself — the response it already sees because
 * it performs the call through a `CopilotRequestHandler`. A response with no
 * usable usage is a fail-loud error, never a silent zero: a zeroed meter is a lie
 * about spend, which CONSTRAINTS.md Constraint 3 forbids.
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
 * @property {number} outputTokens - Tokens generated.
 */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Read a numeric field from an object, or `undefined` when it is absent or not a
 * number — so a non-numeric token count is treated as missing rather than coerced.
 *
 * @param {Record<string, unknown>} source - The object to read from.
 * @param {string} key - The field name.
 * @returns {number | undefined} The number, or undefined.
 */
function numberAt(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' ? value : undefined;
}

/**
 * Extract `{ inputTokens, outputTokens }` from a provider response body, spanning
 * the OpenAI Chat Completions shape (`prompt_tokens` / `completion_tokens`) and
 * the OpenAI Responses / Anthropic shape (`input_tokens` / `output_tokens`).
 *
 * @param {unknown} body - The parsed JSON response body.
 * @returns {TokenUsage} The extracted token counts.
 * @throws {Error} When the body carries no usage block, or no recognisable token counts — reported loudly rather than defaulted to zero.
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
