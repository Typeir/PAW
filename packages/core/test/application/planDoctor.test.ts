/**
 * PAW Plan Doctor Tests
 *
 * @fileoverview The role-binding check the plan doctor adds: unknown role, no
 * resolved model, a satisfying model, and the shortfall that used to surface
 * only at dispatch. Covers `planDoctor.ts` to 100%.
 *
 * @module @paw/core/test/application/planDoctor
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import {
  checkRoleBinding,
  doctorPlanWithBinding,
} from '../../src/application/planDoctor.js';
import type { ModelCapabilities } from '../../src/domain/role.js';
import type { SwarmPlan } from '../../src/domain/swarm.js';

const DEEPSEEK: ModelCapabilities = {
  contextTokens: 128_000,
  maxOutputTokens: 8_192,
  tools: true,
  structuredOutput: true,
  reasoning: true,
  vision: false,
  costClass: 'cheap',
};

/**
 * One-member plan bound to the named role.
 *
 * @param {string} role - Role id the plan declares.
 * @returns {SwarmPlan<unknown>} The plan.
 */
function plan(role: string): SwarmPlan<unknown> {
  return {
    name: 'audit',
    role,
    args: {},
    members: 1,
    brief: () => 'do the thing',
  };
}

describe('checkRoleBinding', () => {
  it('refuses a plan naming a role PAW does not declare', () => {
    const finding = checkRoleBinding(plan('review.chew'), null);
    expect(finding).toMatchObject({ check: 'role-binding', ok: false });
    expect(finding.detail).toContain('unknown role "review.chew"');
    expect(finding.detail).toContain('edit.apply');
  });

  it('says the check did not run when no model was resolved', () => {
    const finding = checkRoleBinding(plan('edit.apply'), null);
    expect(finding.ok).toBe(true);
    expect(finding.detail).toContain('not checked; pass --live');
  });

  it('passes a model that satisfies the role', () => {
    expect(
      checkRoleBinding(plan('edit.apply'), {
        modelId: 'deepseek-chat',
        capabilities: DEEPSEEK,
      }),
    ).toEqual({
      check: 'role-binding',
      ok: true,
      detail: 'edit.apply → deepseek-chat',
    });
  });

  it('names the output-ceiling shortfall that used to surface only at dispatch', () => {
    const finding = checkRoleBinding(plan('review.judge'), {
      modelId: 'deepseek-chat',
      capabilities: DEEPSEEK,
    });
    expect(finding.ok).toBe(false);
    expect(finding.detail).toBe(
      'review.judge → deepseek-chat: max output 8192 < required 16384',
    );
  });
});

describe('doctorPlanWithBinding', () => {
  it('appends the role-binding finding to the plan findings', () => {
    const findings = doctorPlanWithBinding(plan('edit.apply'), null);
    expect(findings.map((f) => f.check)).toContain('role-binding');
    expect(findings[0]?.check).toBe('count');
  });

  it('refuses when the plan is sound but its role is not servable', () => {
    const findings = doctorPlanWithBinding(plan('review.judge'), {
      modelId: 'deepseek-chat',
      capabilities: DEEPSEEK,
    });
    expect(findings.every((f) => f.ok)).toBe(false);
  });
});
