/**
 * @fileoverview Covers {@link parseProviderUsage} across the wire formats PAW's
 * BYOK egress spans — OpenAI Chat Completions (`prompt_tokens`/`completion_tokens`)
 * and the OpenAI Responses / Anthropic shape (`input_tokens`/`output_tokens`) —
 * and proves it fails loud rather than reporting a fabricated zero when a response
 * carries no usable usage, per CONSTRAINTS.md Constraint 3.
 *
 * @module @paw/daemon/test/model/providerUsage
 */

import { describe, expect, it } from 'vitest';
import { parseProviderUsage } from '../../src/infrastructure/model/providerUsage.js';

describe('parseProviderUsage', () => {
  it('reads the OpenAI Chat Completions shape', () => {
    expect(parseProviderUsage({ usage: { prompt_tokens: 12, completion_tokens: 8 } })).toEqual({
      inputTokens: 12,
      outputTokens: 8,
    });
  });

  it('reads the Anthropic / OpenAI Responses shape', () => {
    expect(parseProviderUsage({ usage: { input_tokens: 30, output_tokens: 5 } })).toEqual({
      inputTokens: 30,
      outputTokens: 5,
    });
  });

  it('throws when the body carries no usage block', () => {
    expect(() => parseProviderUsage({})).toThrow(/no usage/i);
    expect(() => parseProviderUsage(null)).toThrow(/no usage/i);
  });

  it('throws when usage is present but not an object', () => {
    expect(() => parseProviderUsage({ usage: 5 })).toThrow(/no usage/i);
  });

  it('throws when a token count is missing', () => {
    expect(() => parseProviderUsage({ usage: { input_tokens: 10 } })).toThrow(/missing token counts/i);
  });

  it('throws when a token count is not a number', () => {
    expect(() => parseProviderUsage({ usage: { input_tokens: 'x', output_tokens: 5 } })).toThrow(
      /missing token counts/i,
    );
  });
});
