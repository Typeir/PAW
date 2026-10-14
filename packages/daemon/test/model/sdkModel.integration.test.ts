/**
 * @fileoverview Exercises the SDK egress pipeline end-to-end against a stub
 * provider. Opt-in behind `PAW_SDK_LIVE=1`; gated because it spawns a ~159 MB
 * Copilot runtime. Sends a completion, reads token usage from the response,
 * and asserts the {@link PawEgress} stamp key and the provided auth token reach
 * the provider. The stub returns token counts 42/7. Runs through daemon-owned
 * BYOK egress. A second case has the stub request two `view` calls and proves
 * the runtime runs both through the herd hooks, honours a deny, and fires the
 * post-tool hook only for the call that ran.
 *
 * @module @paw/daemon/test/model/sdkModel.integration
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHerdHooks } from '../../src/application/herdHooks.js';
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
      hooks: {},
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

  it('runs every member tool call through the herd hooks and honours a deny', async () => {
    home = await mkdtemp(join(tmpdir(), 'paw-sdk-hooks-'));
    await writeFile(join(home, 'notes.md'), 'plain notes', 'utf8');
    await writeFile(join(home, '.env'), 'SECRET=hunter2', 'utf8');
    const reason = 'environment files must never enter the model context';
    const relayed: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const pathOf = (payload: Record<string, unknown>): string => {
      const args = typeof payload.toolArgs === 'string' ? JSON.parse(payload.toolArgs) : payload.toolArgs;
      return String((args as { path?: unknown } | undefined)?.path ?? '');
    };
    const hooks = createHerdHooks(async (event, payload) => {
      relayed.push({ event, payload });
      const path = pathOf(payload);
      return event === 'tool.pre' && path.endsWith('.env')
        ? { permissionDecision: 'deny', permissionDecisionReason: reason }
        : {};
    }, () => undefined, true);

    let toolNames: string[] = [];
    let finalBody = '';
    const call = (name: string, path: string) => ({
      index: 0,
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: `call-${path.length}`, type: 'function', function: { name, arguments: JSON.stringify({ path }) } }],
      },
    });
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const parsed = JSON.parse(body) as { messages: Array<{ role: string }>; tools?: Array<{ function: { name: string } }> };
        toolNames = parsed.tools?.map((tool) => tool.function.name) ?? toolNames;
        const results = parsed.messages.filter((message) => message.role === 'tool').length;
        const choice =
          results === 0
            ? call('view', join(home, 'notes.md'))
            : results === 1
              ? call('view', join(home, '.env'))
              : { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'done' } };
        if (results >= 2) finalBody = body;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-stub', object: 'chat.completion', created: 1, model: 'stub-model',
          choices: [choice],
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        }));
      });
    });
    const baseUrl = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}/v1`);
      });
    });
    const { port, close } = await openSdkModel({
      provider: { type: 'openai', baseUrl },
      authToken: () => 'sk-stub',
      baseDirectory: join(home, '.copilot-home'),
      workingDirectory: home,
      safemode: false,
      hooks,
    });

    try {
      const result = await port.complete({ model: 'stub-model', prompt: 'Read the notes.', maxOutputTokens: 256 });
      expect(result.content).toBe('done');
      expect(toolNames).toEqual(expect.arrayContaining(['view', 'grep']));
      const pre = relayed.filter((r) => r.event === 'tool.pre');
      expect(pre.map((r) => r.payload.toolName)).toEqual(['view', 'view']);
      expect(typeof pre[0]?.payload.sessionId).toBe('string');
      const post = relayed.filter((r) => r.event === 'tool.post');
      expect(pre.map((r) => pathOf(r.payload))).toEqual([join(home, 'notes.md'), join(home, '.env')]);
      expect(post.map((r) => pathOf(r.payload))).toEqual([join(home, 'notes.md')]);
      expect(finalBody).toContain(reason);
      expect(finalBody).not.toContain('SECRET');
    } finally {
      await close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 120_000);
});
