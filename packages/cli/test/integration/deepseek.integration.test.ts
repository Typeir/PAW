/**
 * @fileoverview A live integration test for the DeepSeek runtime. It is opt-in:
 * skipped unless `PAW_LIVE=1`, so `npm test` and CI never spend credit or need a
 * key. When enabled it loads `DEEPSEEK_KEY` from `.env.local` in-process (the key
 * never crosses as an argument, never enters a log, and never enters a prompt),
 * runs one real completion through the same {@link SessionRun} seam a herd uses,
 * and asserts real content and token usage came back. This is the integration
 * tier that proves the excluded `deepseekRuntime.ts` actually talks to the model.
 *
 * @module @paw/cli/test/integration/deepseek
 */

import { describe, expect, it } from 'vitest';
import { createDeepSeekSession, loadEnvLocal } from '../../src/deepseekRuntime.js';

const LIVE = process.env.PAW_LIVE === '1';

describe.skipIf(!LIVE)('deepseek runtime (integration)', () => {
  it('loads the key in-process and completes a short prompt with usage', async () => {
    await loadEnvLocal(process.cwd());
    expect(process.env.DEEPSEEK_KEY, 'DEEPSEEK_KEY must load from .env.local').toBeTruthy();

    const run = createDeepSeekSession();
    const result = await run({
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      prompt: 'Reply with exactly one word: pong.',
      maxOutputTokens: 16,
    });

    expect(result.content.trim().length).toBeGreaterThan(0);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  }, 30_000);
});
