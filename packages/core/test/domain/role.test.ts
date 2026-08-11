/**
 * Paw role domain tests.
 *
 * @fileoverview Cover `satisfies` across every shortfall — context, output,
 * each boolean capability, cost tier — plus fully-satisfied case.
 *
 * @module @paw/core/test/domain/role
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import {
  satisfies,
  type ModelCapabilities,
  type RoleRequirements,
} from '../../src/domain/role.js';

/**
 * Build modest requirement. Override probe one dimension.
 *
 * @param {Partial<RoleRequirements>} over - Override field.
 * @returns {RoleRequirements} Requirement.
 */
const req = (over: Partial<RoleRequirements> = {}): RoleRequirements => ({
  minContextTokens: 32_000,
  maxOutputTokens: 4_096,
  tools: true,
  structuredOutput: false,
  reasoning: false,
  vision: false,
  costClass: 'cheap',
  latencyClass: 'batch',
  ...over,
});

/**
 * Build model that meets modest requirement. Override break it.
 *
 * @param {Partial<ModelCapabilities>} over - Override field.
 * @returns {ModelCapabilities} Capability set.
 */
const cap = (over: Partial<ModelCapabilities> = {}): ModelCapabilities => ({
  contextTokens: 128_000,
  maxOutputTokens: 8_192,
  tools: true,
  structuredOutput: true,
  reasoning: true,
  vision: true,
  costClass: 'cheap',
  ...over,
});

describe('satisfies', () => {
  it('is ok when every requirement is met', () => {
    expect(satisfies(req(), cap())).toEqual({ ok: true, reasons: [] });
  });

  it('flags too small a context window', () => {
    const s = satisfies(req(), cap({ contextTokens: 8_000 }));
    expect(s.ok).toBe(false);
    expect(s.reasons[0]).toContain('context');
  });

  it('flags too little output budget', () => {
    const s = satisfies(req({ maxOutputTokens: 16_000 }), cap());
    expect(s.ok).toBe(false);
    expect(s.reasons[0]).toContain('max output');
  });

  it('flags a missing tool capability', () => {
    const s = satisfies(req({ tools: true }), cap({ tools: false }));
    expect(s.reasons).toContain('requires tool calls');
  });

  it('flags each missing boolean capability the role needs', () => {
    const s = satisfies(
      req({ structuredOutput: true, reasoning: true, vision: true }),
      cap({ structuredOutput: false, reasoning: false, vision: false }),
    );
    expect(s.reasons).toEqual([
      'requires structured output',
      'requires reasoning',
      'requires vision',
    ]);
  });

  it('does not flag a capability the role does not require', () => {
    const s = satisfies(req({ vision: false }), cap({ vision: false }));
    expect(s.ok).toBe(true);
  });

  it('flags a model more expensive than the role allows', () => {
    const s = satisfies(req({ costClass: 'cheap' }), cap({ costClass: 'premium' }));
    expect(s.reasons.some((r) => r.includes('cost tier'))).toBe(true);
  });

  it('accepts a model cheaper than the ceiling', () => {
    expect(satisfies(req({ costClass: 'standard' }), cap({ costClass: 'trivial' })).ok).toBe(true);
  });
});
