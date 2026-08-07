/**
 * @fileoverview Covers {@link handleEgress}, the pure core of PAW's daemon-owned
 * BYOK egress: it stamps the provider key onto the outbound request, performs the
 * call through an injected fetch, and — only for a successful response tied to a
 * session — reads token usage from the body and reports it. Proven here with a
 * fake fetch and no SDK, so the real `CopilotRequestHandler` subclass stays a thin
 * shell. The key is asserted present on the request the fetch receives, never
 * logged.
 *
 * @module @paw/daemon/test/model/pawEgressLogic
 */

import { describe, expect, it, vi } from 'vitest';
import { handleEgress } from '../../src/model/pawEgressLogic.js';
import type { TokenUsage } from '../../src/model/providerUsage.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('handleEgress', () => {
  it('stamps the key on the request, calls through, and reports usage for a session', async () => {
    let seenAuth: string | null = null;
    const recorded: Array<{ sessionId: string; usage: TokenUsage }> = [];
    const fetchImpl = vi.fn(async (req: Request) => {
      seenAuth = req.headers.get('authorization');
      return jsonResponse({ usage: { prompt_tokens: 11, completion_tokens: 4 } });
    });

    const res = await handleEgress(new Request('https://api.example.com/v1/chat/completions', { method: 'POST' }), 'sess-1', {
      authToken: async () => 'sk-secret',
      fetchImpl,
      onUsage: (sessionId, usage) => recorded.push({ sessionId, usage }),
    });

    expect(seenAuth).toBe('Bearer sk-secret');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(recorded).toEqual([{ sessionId: 'sess-1', usage: { inputTokens: 11, outputTokens: 4 } }]);
    expect(res.status).toBe(200);
  });

  it('does not report usage for a non-2xx response', async () => {
    const onUsage = vi.fn();
    const res = await handleEgress(new Request('https://api.example.com/v1/chat/completions'), 'sess-2', {
      authToken: () => 'sk',
      fetchImpl: async () => jsonResponse({ error: 'nope' }, 500),
      onUsage,
    });
    expect(res.status).toBe(500);
    expect(onUsage).not.toHaveBeenCalled();
  });

  it('does not report usage when there is no session to attribute it to', async () => {
    const onUsage = vi.fn();
    await handleEgress(new Request('https://api.example.com/v1/chat/completions'), undefined, {
      authToken: () => 'sk',
      fetchImpl: async () => jsonResponse({ usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      onUsage,
    });
    expect(onUsage).not.toHaveBeenCalled();
  });
});
