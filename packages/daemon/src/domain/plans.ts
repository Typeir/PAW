/**
 * PAW daemon plan find.
 *
 * @fileoverview Find swarm plans repo hold. Resolve where config live. Both pure function over directory listing daemon already hold. Plan is any `*.swarm.mjs`. Discovery match filenames. Import nothing.
 *
 * @module @paw/daemon/plans
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { FileEntry } from './tree.js';

/**
 * Suffix that mark swarm plan.
 */
export const PLAN_SUFFIX = '.swarm.mjs';

/**
 * Config live by convention.
 */
export const CONFIG_PATH = '.paw/config.json';

/**
 * Plans in listing. Repo-relative. Sorted.
 *
 * @param {readonly FileEntry[]} entries - The repository listing.
 * @returns {string[]} Every plan path, sorted.
 */
export function discoverPlans(entries: readonly FileEntry[]): string[] {
  return entries
    .filter((entry) => entry.isFile && entry.path.endsWith(PLAN_SUFFIX))
    .map((entry) => entry.path)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Resolve config path from explicit ask and repo listing. Explicit path win. Else use conventional `.paw/config.json` when listing hold it. Empty string mean repo no config; doctor then report every missing key.
 *
 * @param {string | undefined} explicit - `--config` path, if given.
 * @param {readonly FileEntry[]} entries - The repository listing.
 * @returns {string} The config path, or empty string when none.
 */
export function findConfig(
  explicit: string | undefined,
  entries: readonly FileEntry[],
): string {
  if (explicit !== undefined && explicit !== '') {
    return explicit;
  }
  return entries.some((entry) => entry.isFile && entry.path === CONFIG_PATH)
    ? CONFIG_PATH
    : '';
}

/**
 * Raised when selection name plan served repo do not hold. Distinct type; router answer 404 for it while other failure propagate.
 */
export class UnknownPlanError extends Error {
  /**
   * @param {string} asked - The plan path asked for.
   */
  constructor(asked: string) {
    super(`no such plan in this repository: ${asked}`);
    this.name = 'UnknownPlanError';
  }
}

/**
 * Resolve which plan request name. Path repo do not hold refused; selection can only name plan daemon discovered.
 *
 * @param {string | null} asked - The requested plan path, or null for none.
 * @param {readonly string[]} plans - The discovered plans.
 * @returns {string | null} The plan to serve, or null when none selected.
 */
export function selectPlan(asked: string | null, plans: readonly string[]): string | null {
  if (asked === null || asked === '') {
    return null;
  }
  const wanted = asked.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!plans.includes(wanted)) {
    throw new UnknownPlanError(asked);
  }
  return wanted;
}
