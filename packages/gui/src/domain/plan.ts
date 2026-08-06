/**
 * PAW Console Plan Behaviour
 *
 * @fileoverview The behaviour a {@link PlanView} owns: clamping a scrub to the
 * members that exist, and answering with a member's brief or resume key. The
 * lookups fail loud — a member index the daemon shipped no brief for is a real
 * disagreement between producer and consumer, and returning an empty string
 * would render a blank editor that looks like an authored-but-empty brief.
 * Pure over plain data, so every branch is a unit test.
 *
 * @module @paw/gui/domain/plan
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { PlanView } from './console.types.js';

/**
 * Clamp a member index into the plan's valid range.
 *
 * @param {PlanView} plan - The plan.
 * @param {number} member - The proposed index.
 * @returns {number} The index, clamped to `[0, total - 1]` (0 for an empty plan).
 */
export function clampMember(plan: PlanView, member: number): number {
  const last = Math.max(0, plan.total - 1);
  return Math.min(last, Math.max(0, member));
}

/**
 * Read one of a plan's pre-rendered per-member arrays, failing loud when the
 * producer shipped nothing for that member.
 *
 * @param {readonly string[]} values - The array to read.
 * @param {number} member - The member index.
 * @param {string} what - What the array holds, for the error message.
 * @returns {string} The value at `member`.
 */
function at(values: readonly string[], member: number, what: string): string {
  const value = values[member];
  if (value === undefined) {
    throw new Error(`PAW console: no ${what} for member ${member}`);
  }
  return value;
}

/**
 * The rendered brief for a member.
 *
 * @param {PlanView} plan - The plan.
 * @param {number} member - The member index.
 * @returns {string} The brief text.
 */
export function briefOf(plan: PlanView, member: number): string {
  return at(plan.briefs, member, 'brief');
}

/**
 * The resume key (slug) for a member.
 *
 * @param {PlanView} plan - The plan.
 * @param {number} member - The member index.
 * @returns {string} The slug.
 */
export function slugOf(plan: PlanView, member: number): string {
  return at(plan.slugs, member, 'slug');
}
