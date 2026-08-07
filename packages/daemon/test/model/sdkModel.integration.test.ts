/**
 * @fileoverview Proves the whole SDK egress pipeline end-to-end against the real
 * Copilot runtime and a stub provider — no API key, opt-in behind `PAW_SDK_LIVE=1`
 * because it spawns the ~159 MB runtime. It asserts the completion returns the
 * stub's content and the stub's *real* token usage (not a fabricated zero),
 * proving that {@link PawEgress} stamped the key, performed the call, read usage
 * from the response, and correlated it to the session — the recovery for the
 * SDK's missing usage. If the token counts came back as the stub's 42/7, the
 * daemon-owned BYOK egress works.
 *
 * @module @paw/daemon/test/model/sdkModel.integration
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openSdkModel } from '../../src/model/sdkModel.js';

const LIVE = process.env.PAW_SDK_LIVE === '1';

describe.skipIf(!LIVE)('SDK model egress (integration)', () => {
  let home = '';
  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });

  it('runs a completion through PAW-owned egress and recovers content and real usage', async () => {
    let sawAuth = false;
    const server = createServer((req, res) => {
      sawAuth ||= req.headers.authorization === 'Bearer sk-stub';
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-stub', object: 'chat.completion', created: 1, model: 'stub-model',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'a gaunt marauder stirs' } }],
          usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
        }));
      });
    });
    const baseUrl = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}/v1`);
      });
    });

    home = await mkdtemp(join(tmpdir(), 'paw-sdk-model-'));
    const { port, close } = await openSdkModel({
      provider: { type: 'openai', baseUrl },
      authToken: () => 'sk-stub',
      baseDirectory: join(home, '.copilot-home'),
    });

    try {
      const result = await port.complete({ model: 'stub-model', prompt: 'Describe a monster.', maxOutputTokens: 256 });
      expect(result.content).toContain('marauder');
      expect(result.inputTokens).toBe(42);
      expect(result.outputTokens).toBe(7);
      expect(sawAuth).toBe(true);
    } finally {
      await close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 90_000);
});
