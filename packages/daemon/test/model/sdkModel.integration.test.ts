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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHerdHooks } from '../../src/application/herdHooks.js';
import { openSdkModel } from '../../src/infrastructure/model/sdkModel.js';
import { startStubProvider, text, toolCall } from '../support/stubProvider.js';

const LIVE = process.env.PAW_SDK_LIVE === '1';

describe.skipIf(!LIVE)('SDK model egress (integration)', () => {
  let home = '';
  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });

  it('runs a completion through PAW-owned egress and recovers content and real usage', async () => {
    const provider = await startStubProvider(() => text('a gaunt marauder stirs'), {
      usage: { promptTokens: 42, completionTokens: 7 },
    });

    home = await mkdtemp(join(tmpdir(), 'paw-sdk-model-'));
    const { port, close } = await openSdkModel({
      provider: { type: 'openai', baseUrl: provider.baseUrl },
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
      expect(provider.requests.some((r) => r.authorization === 'Bearer sk-stub')).toBe(true);
      expect(provider.requests.at(-1)?.body.max_tokens).toBe(256);
    } finally {
      await close();
      await provider.close();
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

    const provider = await startStubProvider(
      (request) =>
        request.toolResults.length === 0
          ? toolCall('view', { path: join(home, 'notes.md') })
          : request.toolResults.length === 1
            ? toolCall('view', { path: join(home, '.env') })
            : text('done'),
      { usage: { promptTokens: 5, completionTokens: 1 } },
    );
    const { port, close } = await openSdkModel({
      provider: { type: 'openai', baseUrl: provider.baseUrl },
      authToken: () => 'sk-stub',
      baseDirectory: join(home, '.copilot-home'),
      workingDirectory: home,
      safemode: false,
      hooks,
    });

    try {
      const result = await port.complete({ model: 'stub-model', prompt: 'Read the notes.', maxOutputTokens: 256 });
      expect(result.content).toBe('done');
      expect(provider.requests.at(-1)?.offeredTools).toEqual(expect.arrayContaining(['view', 'grep']));
      const pre = relayed.filter((r) => r.event === 'tool.pre');
      expect(pre.map((r) => r.payload.toolName)).toEqual(['view', 'view']);
      expect(typeof pre[0]?.payload.sessionId).toBe('string');
      const post = relayed.filter((r) => r.event === 'tool.post');
      expect(pre.map((r) => pathOf(r.payload))).toEqual([join(home, 'notes.md'), join(home, '.env')]);
      expect(post.map((r) => pathOf(r.payload))).toEqual([join(home, 'notes.md')]);
      const finalBody = provider.requests.at(-1)?.raw ?? '';
      expect(finalBody).toContain(reason);
      expect(finalBody).not.toContain('SECRET');
    } finally {
      await close();
      await provider.close();
    }
  }, 120_000);
});
