/**
 * @fileoverview Cover {@link liveSdkRegistryFor}: open SDK model against the configured BYOK provider, bind plan role to model in registry, forward client close hook. Covers provider block, key read from the profile at egress, role binding, without spawning a runtime process. A run with no model id throws, naming the provider file.
 *
 * @module @paw/daemon/test/model/liveSdkRegistry
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelPort, SwarmPlan } from '@paw/core';
import {
  LIVE_CAPS,
  liveModelId,
  liveSdkRegistryFor,
  type OpenModel,
} from '../../src/infrastructure/model/liveSdkRegistry.js';
import type { ProviderProfile } from '../../src/infrastructure/model/providerEnv.js';
import type { OpenSdkModelOptions } from '../../src/infrastructure/model/sdkModel.js';

const PLAN = { name: 'monsters', role: 'lore.author', members: () => 1, brief: () => 'x' } as unknown as SwarmPlan<unknown>;
const fakePort: ModelPort = { complete: async () => ({ content: '', inputTokens: 0, outputTokens: 0 }) };

const HOOKS = { onPreToolUse: async () => undefined };
const GEMINI: ProviderProfile = {
  name: 'gemini',
  type: 'openai',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  model: 'gemini-2.5-flash',
  key: 'AIza-secret',
};
const BASE = { baseDirectory: '/tmp/home', workingDirectory: '/repo', safemode: false, hooks: HOOKS };
let captured: OpenSdkModelOptions | null = null;
let closeSpy: ReturnType<typeof vi.fn>;
const openModel: OpenModel = async (options) => {
  captured = options;
  return { port: fakePort, close: closeSpy };
};

beforeEach(() => {
  captured = null;
  closeSpy = vi.fn(async () => undefined);
});

describe('liveSdkRegistryFor', () => {
  it('drives wire type, endpoint, model, and key from the provider, binding the plan role and forwarding close', async () => {
    const { registry, close } = await liveSdkRegistryFor(PLAN, openModel, {
      ...BASE,
      safemode: true,
      provider: GEMINI,
    });

    expect(captured?.provider).toEqual({
      type: 'openai',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    });
    expect(captured?.baseDirectory).toBe('/tmp/home');
    expect(captured?.workingDirectory).toBe('/repo');
    expect(captured?.safemode).toBe(true);
    expect(captured?.hooks).toBe(HOOKS);
    expect(captured!.authToken()).toBe('AIza-secret');
    const binding = registry.bindings.get('lore.author');
    expect(binding?.modelId).toBe('gemini-2.5-flash');
    expect(binding?.port).toBe(fakePort);

    await close();
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('honours baseUrl and model overrides over the provider', async () => {
    const { registry } = await liveSdkRegistryFor(PLAN, openModel, {
      ...BASE,
      provider: { ...GEMINI, type: 'anthropic' },
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen',
    });
    expect(captured?.provider).toEqual({ type: 'anthropic', baseUrl: 'http://localhost:11434/v1' });
    expect(registry.bindings.get('lore.author')?.modelId).toBe('qwen');
  });

  it('refuses to open the runtime when no model id is resolved', async () => {
    const { model: _omitted, ...modelless } = GEMINI;
    await expect(
      liveSdkRegistryFor(PLAN, openModel, { ...BASE, provider: modelless }),
    ).rejects.toThrow('add MODEL to .paw/gemini.provider.env');
    expect(captured).toBeNull();
  });
});

describe('liveModelId', () => {
  it('prefers an explicit override over the provider', () => {
    expect(liveModelId({ model: 'explicit', provider: GEMINI })).toBe('explicit');
  });

  it('falls back to the provider model', () => {
    expect(liveModelId({ provider: GEMINI })).toBe('gemini-2.5-flash');
  });

  it('throws, naming the provider file, when neither names a model', () => {
    const { model: _omitted, ...modelless } = GEMINI;
    expect(() => liveModelId({ provider: modelless })).toThrow(
      'provider "gemini" names no model: add MODEL to .paw/gemini.provider.env',
    );
  });

  it('declares the output ceiling the provider actually serves', () => {
    expect(LIVE_CAPS.maxOutputTokens).toBe(8_192);
  });
});
