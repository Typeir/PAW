/**
 * PAW Console Plan Behaviour
 *
 * @fileoverview {@link PlanView} behaviour: clamp scrub to members that exist,
 * return member brief or resume key. Failed lookup throws; producer sent no
 * brief for that member index, so producer and consumer disagree. Return empty
 * string, render blank editor that looks like an authored-but-empty brief.
 * Operates on plain data only, so every branch is unit-testable.
 *
 * @module @paw/gui/domain/plan
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { PlanView } from './console.types.js';

/**
 * Clamp member index into plan valid range.
 *
 * @param {PlanView} plan - Plan.
 * @param {number} member - Proposed index.
 * @returns {number} Index, clamped to `[0, total - 1]` (0 for empty plan).
 */
export function clampMember(plan: PlanView, member: number): number {
  const last = Math.max(0, plan.total - 1);
  return Math.min(last, Math.max(0, member));
}

/**
 * Read one pre-rendered per-member array; throw when producer sent no value
 * for that member.
 *
 * @param {readonly string[]} values - Array to read.
 * @param {number} member - Member index.
 * @param {string} what - What array hold, for error message.
 * @returns {string} Value at `member`.
 */
function at(values: readonly string[], member: number, what: string): string {
  const value = values[member];
  if (value === undefined) {
    throw new Error(`PAW console: no ${what} for member ${member}`);
  }
  return value;
}

/**
 * Rendered brief for member.
 *
 * @param {PlanView} plan - Plan.
 * @param {number} member - Member index.
 * @returns {string} Brief text.
 */
export function briefOf(plan: PlanView, member: number): string {
  return at(plan.briefs, member, 'brief');
}

/**
 * Resume key (slug) for member.
 *
 * @param {PlanView} plan - Plan.
 * @param {number} member - Member index.
 * @returns {string} Slug.
 */
export function slugOf(plan: PlanView, member: number): string {
  return at(plan.slugs, member, 'slug');
}
