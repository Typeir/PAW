/**
 * @fileoverview Cover the provider-env module: filename → provider name, file
 * parse with required KEY/BASE_URL and wire-type check, and provider choice —
 * requested name, single-provider default, deepseek preference, and the loud
 * refusals with the configured roster named.
 *
 * @module @paw/daemon/test/model/providerEnv
 */

import { describe, expect, it } from 'vitest';
import {
  chooseProvider,
  parseProviderEnv,
  providerNameOf,
  type ProviderProfile,
} from '../../src/infrastructure/model/providerEnv.js';

const profile = (over: Partial<ProviderProfile> = {}): ProviderProfile => ({
  name: 'deepseek',
  type: 'openai',
  baseUrl: 'https://api.deepseek.com',
  key: 'sk-x',
  ...over,
});

describe('providerNameOf', () => {
  it('takes the provider name from a .provider.env filename', () => {
    expect(providerNameOf('deepseek.provider.env')).toBe('deepseek');
    expect(providerNameOf('gemini-flash.provider.env')).toBe('gemini-flash');
  });

  it('names nothing for any other file', () => {
    expect(providerNameOf('config.json')).toBeNull();
    expect(providerNameOf('provider.env')).toBeNull();
    expect(providerNameOf('Deepseek.provider.env')).toBeNull();
  });
});

describe('parseProviderEnv', () => {
  it('parses key, base url, type, and model, stripping quotes and comments', () => {
    const text = [
      '# gemini via its openai-compatible endpoint',
      'KEY="AIza-secret"',
      'BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai',
      'TYPE=openai',
      "MODEL='gemini-2.5-flash'",
    ].join('\n');
    expect(parseProviderEnv('gemini', text)).toEqual({
      name: 'gemini',
      type: 'openai',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.5-flash',
      key: 'AIza-secret',
    });
  });

  it('defaults the wire type to openai and leaves model off when absent', () => {
    const parsed = parseProviderEnv('deepseek', 'KEY=sk\nBASE_URL=https://api.deepseek.com');
    expect(parsed.type).toBe('openai');
    expect(parsed.model).toBeUndefined();
  });

  it('throws, naming the file, when KEY or BASE_URL is missing', () => {
    expect(() => parseProviderEnv('gemini', 'KEY=x')).toThrow('gemini.provider.env needs KEY and BASE_URL');
    expect(() => parseProviderEnv('gemini', 'BASE_URL=x')).toThrow('needs KEY and BASE_URL');
  });

  it('throws on a wire type outside openai, azure, anthropic', () => {
    expect(() => parseProviderEnv('x', 'KEY=k\nBASE_URL=u\nTYPE=grpc')).toThrow(
      'not one of openai, azure, anthropic',
    );
  });
});

describe('chooseProvider', () => {
  it('honours a requested name and throws on an unknown one, listing the roster', () => {
    const providers = new Map([
      ['deepseek', profile()],
      ['gemini', profile({ name: 'gemini' })],
    ]);
    expect(chooseProvider(providers, 'gemini').name).toBe('gemini');
    expect(() => chooseProvider(providers, 'openai')).toThrow('configured: deepseek, gemini');
  });

  it('defaults to the single configured provider', () => {
    expect(chooseProvider(new Map([['gemini', profile({ name: 'gemini' })]]), undefined).name).toBe(
      'gemini',
    );
  });

  it('prefers deepseek among several when nothing is requested', () => {
    const providers = new Map([
      ['gemini', profile({ name: 'gemini' })],
      ['deepseek', profile()],
    ]);
    expect(chooseProvider(providers, undefined).name).toBe('deepseek');
  });

  it('throws when several are configured, none requested, none deepseek', () => {
    const providers = new Map([
      ['gemini', profile({ name: 'gemini' })],
      ['azure', profile({ name: 'azure' })],
    ]);
    expect(() => chooseProvider(providers, undefined)).toThrow('set PAW_PROVIDER');
  });

  it('throws naming an empty roster', () => {
    expect(() => chooseProvider(new Map(), 'gemini')).toThrow('(none)');
    expect(() => chooseProvider(new Map(), undefined)).toThrow('(none configured)');
  });
});
