/**
 * @fileoverview Cover {@link createSdkSessionRun}: it open agentic session on
 * shared client with model, provider block, working directory, tools resolved
 * from request canonical grant, and injected permission handler; return reply
 * content with token usage egress record for that session; always disconnect
 * session; and throw when no usage seen. Test with fake client and pre-seeded
 * usage map, so Copilot runtime stay out of unit tier.
 *
 * @module @paw/daemon/test/model/sdkSessionRun
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createSdkSessionRun,
  type AgentToolConfig,
  type SdkClientLike,
  type SdkSessionLike,
} from '../../src/infrastructure/model/sdkSessionRun.js';
import type { TokenUsage } from '../../src/infrastructure/model/providerUsage.js';

const PROVIDER = { type: 'openai', baseUrl: 'https://api.deepseek.com' } as const;
const approveAll = (): string => 'approved';
const AGENT: AgentToolConfig = { workingDirectory: '/repo', safemode: false, onPermissionRequest: approveAll };

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
  it('runs an agentic completion under the working directory, publishes the output cap for the egress, then clears it', async () => {
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

    const run = createSdkSessionRun(client, PROVIDER, usage, maxTokens, AGENT);
    const result = await run({ model: 'deepseek-chat', prompt: 'Describe a monster.', maxOutputTokens: 8192 });

    expect(result).toEqual({ content: 'a monster stirs', inputTokens: 11, outputTokens: 4 });
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'deepseek-chat',
        provider: { type: 'openai', baseUrl: 'https://api.deepseek.com' },
        workingDirectory: '/repo',
        availableTools: ['builtin:*'],
        excludedTools: [],
        onPermissionRequest: approveAll,
      }),
    );
    expect(capDuringSend).toBe(8192);
    expect(maxTokens.has('s1')).toBe(false);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(usage.has('s1')).toBe(false);
  });

  it('resolves the request grant under safemode into the session allow and deny lists', async () => {
    const usage = new Map<string, TokenUsage>([['s4', { inputTokens: 2, outputTokens: 1 }]]);
    const maxTokens = new Map<string, number>();
    const { client, createSession } = fakeClient({ sessionId: 's4' });
    const safe: AgentToolConfig = { workingDirectory: '/repo', safemode: true, onPermissionRequest: approveAll };

    const run = createSdkSessionRun(client, PROVIDER, usage, maxTokens, safe);
    await run({ model: 'm', prompt: 'p', availableTools: ['read', 'edit'] });

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        availableTools: ['builtin:view', 'builtin:edit'],
        excludedTools: [
          'builtin:powershell',
          'builtin:list_powershell',
          'builtin:read_powershell',
          'builtin:stop_powershell',
          'builtin:bash',
        ],
      }),
    );
  });

  it('maps request system sections into a customize systemMessage of replace actions', async () => {
    const usage = new Map<string, TokenUsage>([['s5', { inputTokens: 1, outputTokens: 1 }]]);
    const maxTokens = new Map<string, number>();
    const { client, createSession } = fakeClient({ sessionId: 's5' });

    const run = createSdkSessionRun(client, PROVIDER, usage, maxTokens, AGENT);
    await run({ model: 'm', prompt: 'p', systemSections: { identity: 'you caveman', safety: 'no leak secret' } });

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        systemMessage: {
          mode: 'customize',
          sections: {
            identity: { action: 'replace', content: 'you caveman' },
            safety: { action: 'replace', content: 'no leak secret' },
          },
        },
      }),
    );
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
    const run = createSdkSessionRun(client, PROVIDER, usage, maxTokens, AGENT);
    expect(await run({ model: 'm', prompt: 'p' })).toEqual({ content: '', inputTokens: 1, outputTokens: 0 });
    expect(capDuringSend).toBeUndefined();
  });

  it('throws, but still disconnects and clears the cap, when no usage was recorded', async () => {
    const usage = new Map<string, TokenUsage>();
    const maxTokens = new Map<string, number>();
    const { client, disconnect } = fakeClient({ sessionId: 's3', sendAndWait: async () => ({ data: { content: 'x' } }) });
    const run = createSdkSessionRun(client, PROVIDER, usage, maxTokens, AGENT);
    await expect(run({ model: 'm', prompt: 'p', maxOutputTokens: 512 })).rejects.toThrow(/no usage recorded/i);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(maxTokens.has('s3')).toBe(false);
  });
});
