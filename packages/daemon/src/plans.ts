/**
 * PAW Daemon Plan Discovery
 *
 * @fileoverview Finds the swarm plans a repository holds, and decides where its
 * config lives. Both are pure functions over a directory listing the daemon
 * already has, which is what lets the console be opened once for a repository
 * rather than once per plan: the daemon serves the repo, and which plan is in
 * view is a selection, not a launch argument.
 *
 * A plan is any `*.swarm.mjs`. Nothing here imports one — discovery is a
 * filename question, and a plan module is code that runs only when an operator
 * actually picks it.
 *
 * @module @paw/daemon/plans
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { FileEntry } from './tree.js';

/**
 * The suffix that marks a swarm plan.
 */
export const PLAN_SUFFIX = '.swarm.mjs';

/**
 * Where a repository's PAW config lives by convention.
 */
export const CONFIG_PATH = '.paw/config.json';

/**
 * The plans in a listing, repo-relative and sorted.
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
 * Where the config is, given what the operator asked for and what the repo
 * holds. An explicit path wins; otherwise the conventional `.paw/config.json`
 * is used when the listing actually contains it. An empty string means the repo
 * has no config — the doctor then reports every missing key rather than the
 * daemon inventing one.
 *
 * @param {string | undefined} explicit - A `--config` path, if given.
 * @param {readonly FileEntry[]} entries - The repository listing.
 * @returns {string} The config path, or an empty string when there is none.
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
 * Raised when a selection names a plan the served repository does not hold. A
 * distinct type, so the router can answer 404 for it while every other failure
 * still propagates loudly.
 */
export class UnknownPlanError extends Error {
  /**
   * @param {string} asked - The plan path that was asked for.
   */
  constructor(asked: string) {
    super(`no such plan in this repository: ${asked}`);
    this.name = 'UnknownPlanError';
  }
}

/**
 * Resolve which plan a request is asking for. A path the repository does not
 * hold is refused rather than loaded: the selection can only ever name a plan
 * the daemon itself discovered, so a request cannot make it import a module
 * from elsewhere on the disk.
 *
 * @param {string | null} asked - The requested plan path, or null for none.
 * @param {readonly string[]} plans - The discovered plans.
 * @returns {string | null} The plan to serve, or null when none is selected.
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
