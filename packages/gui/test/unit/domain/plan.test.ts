/**
 * Plan Domain Tests
 *
 * @fileoverview Covers the plan's behaviour: clamping a scrub to the members
 * that exist, and the loud failure when the producer's per-member arrays do not
 * cover the member being read.
 *
 * @module @paw/gui/test/unit/domain/plan
 */

import { describe, expect, it } from 'vitest';
import type { PlanView } from '../../../src/domain/console.types.js';
import { briefOf, clampMember, slugOf } from '../../../src/domain/plan.js';

const plan: PlanView = {
  name: 'demo',
  role: 'lore.author',
  total: 3,
  source: 'const x = 1;',
  highlightLine: 0,
  briefs: ['one', 'two', 'three'],
  slugs: ['a', 'b', 'c'],
};

describe('clampMember', () => {
  it('keeps an index inside the range', () => {
    expect(clampMember(plan, 1)).toBe(1);
  });

  it('clamps below zero to the first member', () => {
    expect(clampMember(plan, -4)).toBe(0);
  });

  it('clamps past the end to the last member', () => {
    expect(clampMember(plan, 99)).toBe(2);
  });

  it('clamps an empty plan to zero', () => {
    expect(clampMember({ ...plan, total: 0 }, 3)).toBe(0);
  });
});

describe('briefOf / slugOf', () => {
  it('reads the pre-rendered brief and slug', () => {
    expect(briefOf(plan, 2)).toBe('three');
    expect(slugOf(plan, 0)).toBe('a');
  });

  it('fails loud when the producer shipped no brief for the member', () => {
    expect(() => briefOf(plan, 7)).toThrow('no brief for member 7');
  });

  it('fails loud when the producer shipped no slug for the member', () => {
    expect(() => slugOf(plan, 7)).toThrow('no slug for member 7');
  });
});
