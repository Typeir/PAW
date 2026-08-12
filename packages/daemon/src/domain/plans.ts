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
 * Directory new plans are scaffolded into, repo-relative.
 */
export const PLANS_DIR = 'plans';

const PLAN_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Whether name can title a new plan file: kebab-case, 1-64 chars, no path
 * characters. The name becomes a filename, so the rule is the safety boundary.
 *
 * @param {string} name - Proposed plan name.
 * @returns {boolean} True when the name is usable.
 */
export function planNameValid(name: string): boolean {
  return PLAN_NAME.test(name);
}

/**
 * Repo-relative path a named plan scaffolds to.
 *
 * @param {string} name - Valid plan name.
 * @returns {string} `plans/<name>.swarm.mjs`.
 */
export function planPathFor(name: string): string {
  return `${PLANS_DIR}/${name}${PLAN_SUFFIX}`;
}

/**
 * Normalise a plan path for deletion, or null when it must be refused: empty,
 * absolute, drive-lettered, traversing (`..`), or not a `*.swarm.mjs`. The
 * suffix check bounds what a delete verb can ever remove to plan files.
 *
 * @param {string} asked - Plan path as the client sent it.
 * @returns {string | null} Normalised repo-relative path, or null.
 */
export function safePlanPath(asked: string): string | null {
  const path = asked.replace(/\\/g, '/').replace(/^\.\//, '');
  if (path === '' || !path.endsWith(PLAN_SUFFIX)) {
    return null;
  }
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    return null;
  }
  if (path.split('/').some((segment) => segment === '..' || segment === '')) {
    return null;
  }
  return path;
}

/**
 * Starter plan file body: one member per entry in `args.files`, read and edit
 * tools, resume keyed by file path.
 *
 * @param {string} name - Valid plan name.
 * @returns {string} `.swarm.mjs` source.
 */
export function planTemplate(name: string): string {
  return [
    '/**',
    ` * @fileoverview Swarm plan \`${name}\`. One member per entry in \`args.files\`.`,
    ' * Fill `files`, adjust the brief, then run:',
    ' *',
    ` *   paw swarm run ${planPathFor(name)}`,
    ' */',
    '',
    'export default {',
    `  name: '${name}',`,
    "  role: 'edit.apply',",
    '  args: { files: [] },',
    '  members: (a) => a.files.length,',
    "  availableTools: ['read', 'edit'],",
    '  brief: (a, m) =>',
    '    [',
    '      `Open ${a.files[m]} and read it fully.`,',
    "      'State the change to make, then make it in place with your tools.',",
    "      'When done, reply with one short line naming what you changed.',",
    "    ].join('\\n'),",
    '  key: (a, m) => a.files[m],',
    '};',
    '',
  ].join('\n');
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
