/**
 * @fileoverview Covers {@link liveSdkRegistryFor}: it opens the SDK model against
 * the DeepSeek-by-default BYOK provider, binds the plan's role to that model in a
 * registry, and forwards the client's close hook. The SDK shell is injected, so
 * the wiring — provider block, the key read from the environment at egress, the
 * role binding — is proven without spawning the runtime. The key is read lazily
 * inside the egress token callback and throws when unset, never defaulting.
 *
 * @module @paw/daemon/test/model/liveSdkRegistry
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelPort, SwarmPlan } from '@paw/core';
import { liveSdkRegistryFor, type OpenModel } from '../../src/infrastructure/model/liveSdkRegistry.js';
import type { OpenSdkModelOptions } from '../../src/infrastructure/model/sdkModel.js';

const PLAN = { name: 'monsters', role: 'lore.author', members: () => 1, brief: () => 'x' } as unknown as SwarmPlan<unknown>;
const fakePort: ModelPort = { complete: async () => ({ content: '', inputTokens: 0, outputTokens: 0 }) };

let captured: OpenSdkModelOptions | null = null;
let closeSpy: ReturnType<typeof vi.fn>;
const openModel: OpenModel = async (options) => {
  captured = options;
  return { port: fakePort, close: closeSpy };
};

beforeEach(() => {
  captured = null;
  closeSpy = vi.fn(async () => undefined);
  delete process.env.DEEPSEEK_KEY;
  delete process.env.DEEPSEEK_BASE_URL;
  delete process.env.DEEPSEEK_MODEL;
});
afterEach(() => {
  delete process.env.DEEPSEEK_KEY;
});

describe('liveSdkRegistryFor', () => {
  it('opens the DeepSeek provider by default and binds the plan role, forwarding close', async () => {
    const { registry, close } = await liveSdkRegistryFor(PLAN, openModel, { baseDirectory: '/tmp/home' });

    expect(captured?.provider).toEqual({ type: 'openai', baseUrl: 'https://api.deepseek.com' });
    expect(captured?.baseDirectory).toBe('/tmp/home');
    const binding = registry.bindings.get('lore.author');
    expect(binding?.modelId).toBe('deepseek-chat');
    expect(binding?.port).toBe(fakePort);

    await close();
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('reads the key from the environment at egress, and throws when it is unset', async () => {
    await liveSdkRegistryFor(PLAN, openModel, { baseDirectory: '/tmp/home' });
    const authToken = captured!.authToken;

    expect(() => authToken()).toThrow(/DEEPSEEK_KEY/);
    process.env.DEEPSEEK_KEY = 'sk-live';
    expect(authToken()).toBe('sk-live');
  });

  it('honours baseUrl and model overrides', async () => {
    const { registry } = await liveSdkRegistryFor(PLAN, openModel, {
      baseDirectory: '/tmp/home',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen',
    });
    expect(captured?.provider.baseUrl).toBe('http://localhost:11434/v1');
    expect(registry.bindings.get('lore.author')?.modelId).toBe('qwen');
  });
});
