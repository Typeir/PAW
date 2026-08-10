/**
 * PAW Config Binding Edit Tests
 *
 * @fileoverview Every arm of the three edits and the capability parser: an id or
 * role that is refused, a model that is not declared, a preserved sibling field,
 * and each way capabilities can be malformed. So `configBinding.ts` reaches 100%.
 *
 * @module @paw/core/test/application/configBinding
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import type { ConfigDocument } from '../../src/domain/config.js';
import type { ModelCapabilities } from '../../src/domain/role.js';
import {
  clearBinding,
  declareModel,
  parseCapabilities,
  setBinding,
} from '../../src/application/configBinding.js';

const caps: ModelCapabilities = {
  contextTokens: 200_000,
  maxOutputTokens: 32_000,
  tools: true,
  structuredOutput: true,
  reasoning: true,
  vision: false,
  costClass: 'standard',
};

const base: ConfigDocument = { root: '.paw', models: { fast: caps }, roles: { 'edit.apply': 'fast' } };

describe('parseCapabilities', () => {
  it('accepts a well-formed object', () => {
    expect(parseCapabilities({ ...caps })).toEqual({ ok: true, capabilities: caps });
  });

  it('refuses a non-object', () => {
    expect(parseCapabilities(42).ok).toBe(false);
  });

  it('refuses a non-positive, non-numeric, or non-finite number field', () => {
    expect(parseCapabilities({ ...caps, contextTokens: 0 })).toMatchObject({ ok: false });
    expect(parseCapabilities({ ...caps, maxOutputTokens: 'x' })).toMatchObject({ ok: false });
    expect(parseCapabilities({ ...caps, contextTokens: NaN })).toMatchObject({ ok: false });
    expect(parseCapabilities({ ...caps, maxOutputTokens: Infinity })).toMatchObject({ ok: false });
  });

  it('refuses a non-boolean field', () => {
    expect(parseCapabilities({ ...caps, tools: 'yes' })).toMatchObject({ ok: false });
  });

  it('refuses an unknown cost class', () => {
    expect(parseCapabilities({ ...caps, costClass: 'free' })).toMatchObject({ ok: false });
  });
});

describe('declareModel', () => {
  it('adds a model, preserving the rest of the document', () => {
    const edit = declareModel(base, 'slow', caps);
    expect(edit).toEqual({
      ok: true,
      config: { root: '.paw', models: { fast: caps, slow: caps }, roles: { 'edit.apply': 'fast' } },
    });
  });

  it('replaces a declaration of the same id', () => {
    const next = { ...caps, vision: true };
    const edit = declareModel(base, 'fast', next);
    expect(edit.ok && edit.config.models).toEqual({ fast: next });
  });

  it('refuses an empty id', () => {
    expect(declareModel(base, '  ', caps)).toEqual({ ok: false, reason: 'a model id is required' });
  });
});

describe('setBinding', () => {
  it('binds a role to a declared model', () => {
    const edit = setBinding(base, 'review.judge', 'fast');
    expect(edit.ok && edit.config.roles).toEqual({ 'edit.apply': 'fast', 'review.judge': 'fast' });
  });

  it('refuses an unknown role', () => {
    expect(setBinding(base, 'made.up', 'fast')).toMatchObject({ ok: false });
  });

  it('refuses a model that is not declared', () => {
    expect(setBinding(base, 'review.judge', 'ghost')).toMatchObject({
      ok: false,
      reason: 'model "ghost" is not declared',
    });
  });
});

describe('clearBinding', () => {
  it('removes a role binding, preserving the others', () => {
    const two: ConfigDocument = { ...base, roles: { 'edit.apply': 'fast', 'review.judge': 'fast' } };
    const edit = clearBinding(two, 'edit.apply');
    expect(edit.ok && edit.config.roles).toEqual({ 'review.judge': 'fast' });
  });

  it('is idempotent when the role was not bound', () => {
    const edit = clearBinding({ root: '.paw' }, 'memory.draft');
    expect(edit).toEqual({ ok: true, config: { root: '.paw', roles: {} } });
  });

  it('refuses an unknown role', () => {
    expect(clearBinding(base, 'made.up')).toMatchObject({ ok: false });
  });
});
