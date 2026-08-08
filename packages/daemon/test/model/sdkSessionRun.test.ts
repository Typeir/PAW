/**
 * @fileoverview Covers {@link createSdkSessionRun}: it opens a tool-less session on
 * the shared client with the model and provider block, returns the reply content
 * with the token usage the egress recorded for that session, always disconnects
 * the session, and throws — rather than reporting zero — when no usage was
 * observed. Proven with a fake client and a pre-seeded usage map, so the real
 * Copilot runtime stays out of the unit tier.
 *
 * @module @paw/daemon/test/model/sdkSessionRun
 */

import { describe, expect, it, vi } from 'vitest';
import { createSdkSessionRun, type SdkClientLike, type SdkSessionLike } from '../../src/infrastructure/model/sdkSessionRun.js';
import type { TokenUsage } from '../../src/infrastructure/model/providerUsage.js';

const PROVIDER = { type: 'openai', baseUrl: 'https://api.deepseek.com' } as const;

function fakeClient(session: Partial<SdkSessionLike> & { sessionId: string }): {
  client: SdkClientLike;
  disconnect: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
} {
  const disconnect = vi.fn(async () => undefined);
  const full: SdkSessionLike = {
    sessionId: session.sessionId,
    sendAndWait: session.sendAndWait ?? (async () => ({ data: { content: 'ok' } })),
    disconnect,
  };
  const createSession = vi.fn(async () => full);
  return { client: { createSession }, disconnect, createSession };
}

describe('createSdkSessionRun', () => {
  it('runs a tool-less completion, publishes the output cap for the egress, then clears it', async () => {
    const usage = new Map<string, TokenUsage>([['s1', { inputTokens: 11, outputTokens: 4 }]]);
    const maxTokens = new Map<string, number>();
    let capDuringSend: number | undefined;
    const { client, disconnect, createSession } = fakeClient({
      sessionId: 's1',
      sendAndWait: async () => {
        capDuringSend = maxTokens.get('s1');
        return { data: { content: 'a monster stirs' } };
      },
    });

    const run = createSdkSessionRun(client, PROVIDER, usage, maxTokens);
    const result = await run({ model: 'deepseek-chat', prompt: 'Describe a monster.', maxOutputTokens: 8192 });

    expect(result).toEqual({ content: 'a monster stirs', inputTokens: 11, outputTokens: 4 });
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'deepseek-chat',
        provider: { type: 'openai', baseUrl: 'https://api.deepseek.com' },
        availableTools: [],
      }),
    );
    expect(capDuringSend).toBe(8192);
    expect(maxTokens.has('s1')).toBe(false);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(usage.has('s1')).toBe(false);
  });

  it('publishes no cap when the request names no maxOutputTokens', async () => {
    const usage = new Map<string, TokenUsage>([['s2', { inputTokens: 1, outputTokens: 0 }]]);
    const maxTokens = new Map<string, number>();
    let capDuringSend: number | undefined = -1;
    const { client } = fakeClient({
      sessionId: 's2',
      sendAndWait: async () => {
        capDuringSend = maxTokens.get('s2');
        return undefined;
      },
    });
    const run = createSdkSessionRun(client, PROVIDER, usage, maxTokens);
    expect(await run({ model: 'm', prompt: 'p' })).toEqual({ content: '', inputTokens: 1, outputTokens: 0 });
    expect(capDuringSend).toBeUndefined();
  });

  it('throws, but still disconnects and clears the cap, when no usage was recorded', async () => {
    const usage = new Map<string, TokenUsage>();
    const maxTokens = new Map<string, number>();
    const { client, disconnect } = fakeClient({ sessionId: 's3', sendAndWait: async () => ({ data: { content: 'x' } }) });
    const run = createSdkSessionRun(client, PROVIDER, usage, maxTokens);
    await expect(run({ model: 'm', prompt: 'p', maxOutputTokens: 512 })).rejects.toThrow(/no usage recorded/i);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(maxTokens.has('s3')).toBe(false);
  });
});
