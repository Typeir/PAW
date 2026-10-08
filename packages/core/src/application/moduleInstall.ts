/**
 * PAW Module Install
 *
 * @fileoverview Clones a catalogued module into `.paw/modules/<id>` at the ref
 * the catalogue pins, and removes one. Planning is pure for both directions;
 * the clone runs through {@link ProcessPort}, so git is the only thing this
 * needs and a test can drive it with a fake. A source may be overridden with a
 * path or URL, which is how a module is installed before it has a remote.
 * Removal is a directory delete, left to the caller — an uninstall is refused
 * while the module is still enabled, so no config ever points at a directory
 * about to disappear.
 *
 * @module @paw/core/application/moduleInstall
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { VENDOR_MODULES, type ModuleEntry } from '../domain/modules.js';
import type { ProcessPort } from '../ports/index.js';

/**
 * Directory, relative to a repository, that installed modules live in.
 */
export const MODULES_DIR = '.paw/modules';

/**
 * What an install will do, or why it will not.
 */
export type InstallPlan =
  | {
      readonly ok: true;
      readonly id: string;
      readonly source: string;
      readonly ref: string;
      readonly target: string;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Plan an install. Unknown ids are refused naming the catalogue; a module
 * already present is refused rather than overwritten.
 *
 * @param {string} id - Module id.
 * @param {string | undefined} from - Source override, a path or URL.
 * @param {boolean} present - Whether `.paw/modules/<id>` already exists.
 * @returns {InstallPlan} The plan, or a refusal.
 */
export function planInstall(
  id: string,
  from: string | undefined,
  present: boolean,
): InstallPlan {
  const entry: ModuleEntry | undefined = VENDOR_MODULES.find(
    (candidate) => candidate.id === id,
  );
  if (entry === undefined) {
    return {
      ok: false,
      reason: `unknown module "${id}"; known: ${VENDOR_MODULES.map((m) => m.id).join(', ')}`,
    };
  }
  if (present) {
    return {
      ok: false,
      reason: `module "${id}" is already installed at ${MODULES_DIR}/${id}; remove that directory to reinstall`,
    };
  }
  return {
    ok: true,
    id,
    source: from ?? entry.repository,
    ref: entry.ref,
    target: `${MODULES_DIR}/${id}`,
  };
}

/**
 * What an uninstall will do, or why it will not.
 */
export type UninstallPlan =
  | { readonly ok: true; readonly id: string; readonly target: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Plan an uninstall. Unknown ids are refused naming the catalogue; a module
 * not present has nothing to remove; a module still enabled is refused so
 * config never points at a directory that is about to disappear.
 *
 * @param {string} id - Module id.
 * @param {boolean} enabled - Whether `.paw/config.json` currently enables it.
 * @param {boolean} present - Whether `.paw/modules/<id>` exists.
 * @returns {UninstallPlan} The plan, or a refusal.
 */
export function planUninstall(id: string, enabled: boolean, present: boolean): UninstallPlan {
  if (!VENDOR_MODULES.some((candidate) => candidate.id === id)) {
    return {
      ok: false,
      reason: `unknown module "${id}"; known: ${VENDOR_MODULES.map((m) => m.id).join(', ')}`,
    };
  }
  if (!present) {
    return { ok: false, reason: `module "${id}" is not installed at ${MODULES_DIR}/${id}` };
  }
  if (enabled) {
    return {
      ok: false,
      reason: `module "${id}" is still enabled; disable it first with paw modules disable ${id}`,
    };
  }
  return { ok: true, id, target: `${MODULES_DIR}/${id}` };
}

/**
 * Outcome of running an install.
 */
export type InstallResult =
  | { readonly ok: true; readonly detail: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Trimmed git output, whichever stream carried it.
 *
 * @param {{ stdout: string; stderr: string }} result - What git wrote.
 * @returns {string} One message.
 */
function said(result: { stdout: string; stderr: string }): string {
  const text = `${result.stderr} ${result.stdout}`.trim();
  return text === '' ? 'git gave no reason' : text;
}

/**
 * Run a planned install: clone, then check out the pinned ref. A failing step
 * reports git's own message.
 *
 * @param {ProcessPort} proc - Where git runs.
 * @param {string} root - Repository the module installs into.
 * @param {Extract<InstallPlan, { ok: true }>} plan - The planned install.
 * @returns {Promise<InstallResult>} Where it landed, or why it did not.
 */
export async function runInstall(
  proc: ProcessPort,
  root: string,
  plan: Extract<InstallPlan, { ok: true }>,
): Promise<InstallResult> {
  const cloned = await proc.run('git', ['clone', plan.source, plan.target], { cwd: root });
  if (cloned.code !== 0) {
    return { ok: false, reason: `could not clone ${plan.source}: ${said(cloned)}` };
  }
  const checked = await proc.run(
    'git',
    ['-C', plan.target, 'checkout', '--detach', plan.ref],
    { cwd: root },
  );
  if (checked.code !== 0) {
    return { ok: false, reason: `cloned, but ref "${plan.ref}" did not check out: ${said(checked)}` };
  }
  return { ok: true, detail: `${plan.target} at ${plan.ref}` };
}
