/**
 * @fileoverview Cover {@link liveSdkRegistryFor} and {@link liveBinding}: open SDK model against the configured BYOK provider, bind plan role to the provider's model with the capabilities `.paw/config.json` declares for it, forward client close hook. Covers provider block, key read from the profile at egress, role binding, without spawning a runtime process. A run with no model id, an undeclared model, or malformed capabilities throws before the runtime opens.
 *
 * @module @paw/daemon/test/model/liveSdkRegistry
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelCapabilities, ModelPort, SwarmPlan } from '@paw/core';
import {
  liveBinding,
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
const { model: _omitted, ...MODELLESS } = GEMINI;
const FLASH: ModelCapabilities = {
  contextTokens: 1_000_000,
  maxOutputTokens: 65_536,
  tools: true,
  structuredOutput: true,
  reasoning: true,
  vision: true,
  costClass: 'cheap',
};
const QWEN: ModelCapabilities = { ...FLASH, contextTokens: 32_768, maxOutputTokens: 4_096, vision: false };
const MODELS = { 'gemini-2.5-flash': FLASH, qwen: QWEN };
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
  it('drives wire type, endpoint, model, and key from the provider and binds the role with the declared capabilities', async () => {
    const { registry, close } = await liveSdkRegistryFor(PLAN, openModel, {
      ...BASE,
      safemode: true,
      provider: GEMINI,
      models: MODELS,
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
    expect(binding?.capabilities).toEqual(FLASH);
    expect(binding?.port).toBe(fakePort);

    await close();
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('honours baseUrl and model overrides over the provider', async () => {
    const { registry } = await liveSdkRegistryFor(PLAN, openModel, {
      ...BASE,
      provider: { ...GEMINI, type: 'anthropic' },
      models: MODELS,
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen',
    });
    expect(captured?.provider).toEqual({ type: 'anthropic', baseUrl: 'http://localhost:11434/v1' });
    expect(registry.bindings.get('lore.author')?.capabilities).toEqual(QWEN);
  });

  it('refuses to open the runtime when no model id is resolved', async () => {
    await expect(
      liveSdkRegistryFor(PLAN, openModel, { ...BASE, provider: MODELLESS, models: MODELS }),
    ).rejects.toThrow('paw providers add gemini --base-url <url> --model <id>');
    expect(captured).toBeNull();
  });

  it('refuses to open the runtime when the config does not declare the model', async () => {
    await expect(
      liveSdkRegistryFor(PLAN, openModel, { ...BASE, provider: GEMINI, models: undefined }),
    ).rejects.toThrow('model "gemini-2.5-flash" is not declared in .paw/config.json');
    expect(captured).toBeNull();
  });
});

describe('liveBinding', () => {
  it('prefers an explicit override over the provider model', () => {
    expect(liveBinding({ provider: GEMINI, model: 'qwen', models: MODELS })).toEqual({
      modelId: 'qwen',
      capabilities: QWEN,
    });
  });

  it('falls back to the provider model, with the capabilities the config declares', () => {
    expect(liveBinding({ provider: GEMINI, models: MODELS })).toEqual({
      modelId: 'gemini-2.5-flash',
      capabilities: FLASH,
    });
  });

  it('throws, naming the provider file, when neither names a model', () => {
    expect(() => liveBinding({ provider: MODELLESS, models: MODELS })).toThrow(
      'provider "gemini" names no model: paw providers add gemini --base-url <url> --model <id>',
    );
  });

  it('throws, naming the verb that declares it, when the config does not declare the model', () => {
    expect(() => liveBinding({ provider: GEMINI, models: { qwen: QWEN } })).toThrow(
      'model "gemini-2.5-flash" is not declared in .paw/config.json; declare it with ' +
        'paw config model gemini-2.5-flash --context N --max-output N --cost <tier>',
    );
  });

  it('throws, naming the field, when the declared capabilities are malformed', () => {
    expect(() =>
      liveBinding({ provider: GEMINI, models: { 'gemini-2.5-flash': { ...FLASH, contextTokens: 0 } } }),
    ).toThrow('model "gemini-2.5-flash" in .paw/config.json: contextTokens must be a positive number');
  });
});
