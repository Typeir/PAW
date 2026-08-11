/**
 * @fileoverview Exercises the SDK egress pipeline end-to-end against a stub
 * provider. Opt-in behind `PAW_SDK_LIVE=1`; gated because it spawns a ~159 MB
 * Copilot runtime. Sends a completion, reads token usage from the response,
 * and asserts the {@link PawEgress} stamp key and the provided auth token reach
 * the provider. The stub returns token counts 42/7. Runs through daemon-owned
 * BYOK egress.
 *
 * @module @paw/daemon/test/model/sdkModel.integration
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openSdkModel } from '../../src/infrastructure/model/sdkModel.js';

const LIVE = process.env.PAW_SDK_LIVE === '1';

describe.skipIf(!LIVE)('SDK model egress (integration)', () => {
  let home = '';
  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });

  it('runs a completion through PAW-owned egress and recovers content and real usage', async () => {
    let sawAuth = false;
    let lastBody = '';
    const server = createServer((req, res) => {
      sawAuth ||= req.headers.authorization === 'Bearer sk-stub';
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        lastBody = body;
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
      workingDirectory: home,
      safemode: false,
    });

    try {
      const result = await port.complete({ model: 'stub-model', prompt: 'Describe a monster.', maxOutputTokens: 256 });
      expect(result.content).toContain('marauder');
      expect(result.inputTokens).toBe(42);
      expect(result.outputTokens).toBe(7);
      expect(sawAuth).toBe(true);
      expect((JSON.parse(lastBody) as { max_tokens?: number }).max_tokens).toBe(256);
    } finally {
      await close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 90_000);
});
