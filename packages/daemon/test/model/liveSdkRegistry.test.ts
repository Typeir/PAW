/**
 * @fileoverview Cover {@link liveSdkRegistryFor}. Open SDK model against DeepSeek-by-default BYOK provider. Bind plan role to model in registry. Forward client close hook. Covers provider block, key read from env at egress, role binding, without spawning a runtime process. Key read lazy inside egress token callback. Throw when unset, never default.
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
    const { registry, close } = await liveSdkRegistryFor(PLAN, openModel, {
      baseDirectory: '/tmp/home',
      workingDirectory: '/repo',
      safemode: true,
    });

    expect(captured?.provider).toEqual({ type: 'openai', baseUrl: 'https://api.deepseek.com' });
    expect(captured?.baseDirectory).toBe('/tmp/home');
    expect(captured?.workingDirectory).toBe('/repo');
    expect(captured?.safemode).toBe(true);
    const binding = registry.bindings.get('lore.author');
    expect(binding?.modelId).toBe('deepseek-chat');
    expect(binding?.port).toBe(fakePort);

    await close();
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('reads the key from the environment at egress, and throws when it is unset', async () => {
    await liveSdkRegistryFor(PLAN, openModel, { baseDirectory: '/tmp/home', workingDirectory: '/repo', safemode: false });
    const authToken = captured!.authToken;

    expect(() => authToken()).toThrow(/DEEPSEEK_KEY/);
    process.env.DEEPSEEK_KEY = 'sk-live';
    expect(authToken()).toBe('sk-live');
  });

  it('honours baseUrl and model overrides', async () => {
    const { registry } = await liveSdkRegistryFor(PLAN, openModel, {
      baseDirectory: '/tmp/home',
      workingDirectory: '/repo',
      safemode: false,
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen',
    });
    expect(captured?.provider.baseUrl).toBe('http://localhost:11434/v1');
    expect(registry.bindings.get('lore.author')?.modelId).toBe('qwen');
  });
});
