/**
 * @fileoverview Cover provider setup: `planProviderAdd` validates the input by
 * round-trip through the provider-env parser and plans the provider file plus
 * `.paw/.gitignore`; `providerHints` names the `paw` verb for each missing step.
 *
 * @module @paw/daemon/test/model/providerSetup
 */

import { describe, expect, it } from 'vitest';
import { parseProviderEnv } from '../../src/infrastructure/model/providerEnv.js';
import {
  formatProviderEnv,
  planProviderAdd,
  providerHints,
} from '../../src/infrastructure/model/providerSetup.js';

const INPUT = {
  name: 'acme',
  type: undefined,
  baseUrl: 'https://llm.acme.test/v1',
  model: 'acme-large',
  key: 'sk-acme\n',
};
const CAPS = {
  contextTokens: 64_000,
  maxOutputTokens: 8_192,
  tools: true,
  structuredOutput: false,
  reasoning: false,
  vision: false,
  costClass: 'cheap',
};

describe('formatProviderEnv', () => {
  it('writes a file the provider-env parser reads back to the same profile', () => {
    const profile = { name: 'acme', type: 'anthropic' as const, baseUrl: 'u', model: 'm', key: 'k' };
    expect(formatProviderEnv(profile)).toBe('TYPE=anthropic\nBASE_URL=u\nMODEL=m\nKEY=k\n');
    expect(parseProviderEnv('acme', formatProviderEnv(profile))).toEqual(profile);
  });
});

describe('planProviderAdd', () => {
  it('plans a private provider file and an ignore file covering it, trimming the key', () => {
    const plan = planProviderAdd(INPUT, '');
    expect(plan).toEqual({
      ok: true,
      profile: { name: 'acme', type: 'openai', baseUrl: 'https://llm.acme.test/v1', model: 'acme-large', key: 'sk-acme' },
      writes: [
        {
          path: '.paw/acme.provider.env',
          content: 'TYPE=openai\nBASE_URL=https://llm.acme.test/v1\nMODEL=acme-large\nKEY=sk-acme\n',
          private: true,
        },
        { path: '.paw/.gitignore', content: expect.stringContaining('\n*.env\n'), private: false },
      ],
    });
  });

  it('keeps an existing ignore file, appending only missing entries', () => {
    const plan = planProviderAdd(INPUT, 'mine\n');
    expect(plan.ok && plan.writes[1].content).toMatch(/^mine\ndaemon\.token\n/);
  });

  it('refuses a name a provider file cannot carry', () => {
    expect(planProviderAdd({ ...INPUT, name: 'Acme Corp' }, '')).toEqual({
      ok: false,
      reason: 'provider name "Acme Corp" must be lowercase letters, digits, and dashes',
    });
  });

  it('refuses a missing base url or model, naming the flag', () => {
    expect(planProviderAdd({ ...INPUT, baseUrl: undefined }, '')).toEqual({
      ok: false,
      reason: 'provider "acme": --base-url is required',
    });
    expect(planProviderAdd({ ...INPUT, model: '' }, '')).toEqual({
      ok: false,
      reason: 'provider "acme": --model is required',
    });
  });

  it('refuses an empty key, saying where it is read from', () => {
    expect(planProviderAdd({ ...INPUT, key: ' \n' }, '')).toEqual({
      ok: false,
      reason: 'provider "acme": no key given; pipe it on stdin or type it at the prompt',
    });
  });

  it('refuses a wire type outside openai, azure, anthropic', () => {
    expect(planProviderAdd({ ...INPUT, type: 'grpc' }, '')).toEqual({
      ok: false,
      reason: 'provider "acme": TYPE "grpc" is not one of openai, azure, anthropic',
    });
  });

  it('refuses a value the file cannot store unchanged, naming the field', () => {
    expect(planProviderAdd({ ...INPUT, model: 'a\nKEY=stolen' }, '')).toEqual({
      ok: false,
      reason: 'provider "acme": MODEL holds a line break, quote, or surrounding space',
    });
    expect(planProviderAdd({ ...INPUT, key: '"sk-acme"' }, '')).toEqual({
      ok: false,
      reason: 'provider "acme": KEY holds a line break, quote, or surrounding space',
    });
  });
});

describe('providerHints', () => {
  it('says how to add a provider when none is configured', () => {
    expect(providerHints([], undefined, undefined)).toEqual([
      'add a provider: paw providers add <name> --base-url <url> --model <id>   (key on stdin)',
    ]);
  });

  it('asks to declare a provider model the config does not declare', () => {
    expect(providerHints([{ name: 'acme', model: 'acme-large' }], {}, undefined)).toEqual([
      'declare model "acme-large": paw config model acme-large --context N --max-output N --cost <tier>',
    ]);
  });

  it('gives no hint when the single provider names a declared model', () => {
    expect(providerHints([{ name: 'acme', model: 'acme-large' }], { 'acme-large': CAPS }, undefined)).toEqual([]);
  });

  it('asks to replace a provider that names no model or does not parse', () => {
    expect(providerHints([{ name: 'acme' }, { name: 'bad', error: 'x' }], undefined, 'acme')).toEqual([
      'provider "acme" names no model: paw providers add acme --base-url <url> --model <id>',
      'provider "bad" does not parse: paw providers add bad --base-url <url> --model <id>',
    ]);
  });

  it('asks to pick one of several with PAW_PROVIDER, and flags a pick that names none', () => {
    const roster = [
      { name: 'acme', model: 'm' },
      { name: 'beta', model: 'm' },
    ];
    expect(providerHints(roster, { m: CAPS }, undefined)).toEqual([
      'several providers: pick one per run with PAW_PROVIDER=<acme|beta>',
    ]);
    expect(providerHints(roster, { m: CAPS }, '')).toEqual([
      'several providers: pick one per run with PAW_PROVIDER=<acme|beta>',
    ]);
    expect(providerHints(roster, { m: CAPS }, 'gamma')).toEqual([
      'PAW_PROVIDER="gamma" names no configured provider; configured: acme, beta',
    ]);
    expect(providerHints(roster, { m: CAPS }, 'beta')).toEqual([]);
  });
});
