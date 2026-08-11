/**
 * PAW model adapter tests.
 *
 * @fileoverview Test Copilot-SDK adapter request/response mapping through fake
 * injected runner, and recording fake model. Both hit 100%; no real provider or
 * key.
 *
 * @module @paw/adapters/test/model/model
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { createCopilotSdkModel } from '../../src/model/copilotSdk.js';
import { createFakeModel } from '../../src/model/fakeModel.js';

describe('createCopilotSdkModel', () => {
  it('maps a request through the injected runner and back to a response', async () => {
    const seen: string[] = [];
    const model = createCopilotSdkModel(async (req) => {
      seen.push(req.prompt);
      return { content: `echo:${req.prompt}`, inputTokens: 12, outputTokens: 3 };
    });

    const res = await model.complete({ model: 'ds-flash', prompt: 'hello' });

    expect(seen).toEqual(['hello']);
    expect(res).toEqual({ content: 'echo:hello', inputTokens: 12, outputTokens: 3 });
  });
});

describe('createFakeModel', () => {
  it('records requests and returns the supplied reply with derived usage', async () => {
    const model = createFakeModel((req) => `re: ${req.prompt}`);

    const res = await model.complete({ model: 'x', prompt: 'abc' });

    expect(model.requests).toHaveLength(1);
    expect(model.requests[0].prompt).toBe('abc');
    expect(res.content).toBe('re: abc');
    expect(res.inputTokens).toBe(3);
    expect(res.outputTokens).toBe('re: abc'.length);
  });
});
