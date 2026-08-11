/**
 * @fileoverview Cover {@link handleEgress}, pure core of PAW daemon BYOK egress.
 * Stamps provider key onto outbound request. Stamps session output ceiling onto
 * chat-completion body — only place provider learn `max_tokens`, SDK forward
 * none. Call through injected fetch. Only for successful response tied to a
 * session, read token usage from body, report it. Proven with fake fetch, no
 * SDK. Key asserted present on request fetch receive, never logged.
 *
 * @module @paw/daemon/test/model/pawEgressLogic
 */

import { describe, expect, it, vi } from 'vitest';
import { handleEgress, type EgressDeps } from '../../src/infrastructure/model/pawEgressLogic.js';
import type { TokenUsage } from '../../src/infrastructure/model/providerUsage.js';

const URL = 'https://api.example.com/v1/chat/completions';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Base egress deps: no cap, ok empty-usage response, overridable per test.
 *
 * @param over - Overrides.
 */
function deps(over: Partial<EgressDeps> = {}): EgressDeps {
  return {
    authToken: async () => 'sk-secret',
    fetchImpl: async () => jsonResponse({ usage: { prompt_tokens: 0, completion_tokens: 0 } }),
    onUsage: () => undefined,
    maxTokensFor: () => undefined,
    ...over,
  };
}

describe('handleEgress', () => {
  it('stamps the key on the request, calls through, and reports usage for a session', async () => {
    let seenAuth: string | null = null;
    const recorded: Array<{ sessionId: string; usage: TokenUsage }> = [];
    const fetchImpl = vi.fn(async (req: Request) => {
      seenAuth = req.headers.get('authorization');
      return jsonResponse({ usage: { prompt_tokens: 11, completion_tokens: 4 } });
    });

    const res = await handleEgress(new Request(URL, { method: 'POST' }), 'sess-1', deps({
      fetchImpl,
      onUsage: (sessionId, usage) => recorded.push({ sessionId, usage }),
    }));

    expect(seenAuth).toBe('Bearer sk-secret');
    expect(recorded).toEqual([{ sessionId: 'sess-1', usage: { inputTokens: 11, outputTokens: 4 } }]);
    expect(res.status).toBe(200);
  });

  it('does not report usage for a non-2xx response', async () => {
    const onUsage = vi.fn();
    const res = await handleEgress(new Request(URL), 'sess-2', deps({
      fetchImpl: async () => jsonResponse({ error: 'nope' }, 500),
      onUsage,
    }));
    expect(res.status).toBe(500);
    expect(onUsage).not.toHaveBeenCalled();
  });

  it('does not report usage when there is no session to attribute it to', async () => {
    const onUsage = vi.fn();
    await handleEgress(new Request(URL), undefined, deps({
      fetchImpl: async () => jsonResponse({ usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      onUsage,
    }));
    expect(onUsage).not.toHaveBeenCalled();
  });

  it('stamps max_tokens onto a chat-completion body when a cap applies', async () => {
    let sent: Record<string, unknown> = {};
    await handleEgress(
      new Request(URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
      }),
      'sess-3',
      deps({
        maxTokensFor: () => 256,
        fetchImpl: async (req) => {
          sent = (await req.json()) as Record<string, unknown>;
          return jsonResponse({ usage: { prompt_tokens: 1, completion_tokens: 1 } });
        },
      }),
    );
    expect(sent.max_tokens).toBe(256);
    expect(sent.messages).toBeDefined();
  });

  it('leaves a JSON body that is not a chat-completion untouched', async () => {
    let sent: Record<string, unknown> = {};
    await handleEgress(
      new Request(URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ping: true }),
      }),
      'sess-4',
      deps({
        maxTokensFor: () => 256,
        fetchImpl: async (req) => {
          sent = (await req.json()) as Record<string, unknown>;
          return jsonResponse({ usage: { prompt_tokens: 0, completion_tokens: 0 } });
        },
      }),
    );
    expect(sent).toEqual({ ping: true });
    expect(sent.max_tokens).toBeUndefined();
  });

  it('does not touch a non-POST request even when a cap applies', async () => {
    let method = '';
    await handleEgress(
      new Request(URL, { method: 'GET' }),
      'sess-5',
      deps({
        maxTokensFor: () => 256,
        fetchImpl: async (req) => {
          method = req.method;
          return jsonResponse({ usage: { prompt_tokens: 0, completion_tokens: 0 } });
        },
      }),
    );
    expect(method).toBe('GET');
  });

  it('does not touch a non-JSON POST even when a cap applies', async () => {
    let text = '';
    await handleEgress(
      new Request(URL, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'raw' }),
      'sess-6',
      deps({
        maxTokensFor: () => 256,
        fetchImpl: async (req) => {
          text = await req.text();
          return jsonResponse({ usage: { prompt_tokens: 0, completion_tokens: 0 } });
        },
      }),
    );
    expect(text).toBe('raw');
  });
});
