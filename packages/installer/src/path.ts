/**
 * PAW Installer PATH Planner
 *
 * @fileoverview Decide how to put PAW bin dir on PATH for detected shell. Return
 * decision as value — a {@link PathEdit} — not do it. Apply step run it through
 * port, so whole decision pure unit test. Two ways: on Windows, replace per-user
 * `Path` in environment store (persist and broadcast by OS API — never `setx`,
 * that truncate PATH at 1024 chars and corrupt it); on POSIX, append one
 * marker-delimited block to shell profile, idempotent so re-run never
 * double-add. Entry already there? Plan say so, change nothing.
 *
 * @module @paw/installer/path
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { profileTarget, type Shell } from './shell.js';

/**
 * Marker start PAW block in POSIX profile (conda/rustup convention).
 */
export const MARK_BEGIN = '# >>> paw >>>';

/**
 * Marker end PAW block in POSIX profile.
 */
export const MARK_END = '# <<< paw <<<';

/**
 * Kind of PATH edit to do.
 */
export type PathEditKind = 'windows-registry' | 'profile-append' | 'already-present';

/**
 * A planned PATH edit — value apply step run.
 *
 * @interface PathEdit
 * @property {PathEditKind} kind - Which strategy, or already-present.
 * @property {string} target - Profile path, or Windows environment store.
 * @property {string} [block] - Marker block to append (profile-append only).
 * @property {string} [newPath] - New `Path` value to persist (windows-registry only).
 */
export interface PathEdit {
  readonly kind: PathEditKind;
  readonly target: string;
  readonly block?: string;
  readonly newPath?: string;
}

/**
 * Inputs planner need.
 *
 * @interface PathPlanInput
 * @property {Shell} shell - Detected shell.
 * @property {string} home - User home directory.
 * @property {string} binDir - PAW bin dir to add to PATH.
 * @property {string} currentPath - Current user `Path` value (Windows only; `;`-separated).
 * @property {string} profileText - Current profile file contents (POSIX only).
 */
export interface PathPlanInput {
  readonly shell: Shell;
  readonly home: string;
  readonly binDir: string;
  readonly currentPath: string;
  readonly profileText: string;
}

/**
 * Windows shape of a PATH entry: backslashes, no trailing slash. Registry
 * accepts forward-slash entries; normalize them here for consistent comparison.
 *
 * @param {string} dir - Directory path, either slash style.
 * @returns {string} Backslashed entry.
 */
function windowsEntry(dir: string): string {
  return dir.replaceAll('/', '\\').replace(/\\+$/, '');
}

/**
 * Whether two Windows PATH entries name the same directory — case, slash style,
 * and trailing slash insensitive, so an old forward-slashed entry count as
 * present and never duplicate.
 *
 * @param {string} left - One entry.
 * @param {string} right - Other entry.
 * @returns {boolean} True when same directory.
 */
function sameWindowsEntry(left: string, right: string): boolean {
  return windowsEntry(left).toLowerCase() === windowsEntry(right).toLowerCase();
}

/**
 * Plan PATH edit for given shell and current state.
 *
 * @param {PathPlanInput} input - Detected shell and current PATH/profile state.
 * @returns {PathEdit} What to change, or nothing need change.
 */
export function planPathEdit(input: PathPlanInput): PathEdit {
  const target = profileTarget(input.shell, input.home);

  if (input.shell === 'powershell') {
    const wanted = windowsEntry(input.binDir);
    const entries = input.currentPath.split(';').filter((e) => e.length > 0);
    if (entries.some((e) => sameWindowsEntry(e, wanted))) {
      return { kind: 'already-present', target };
    }
    return { kind: 'windows-registry', target, newPath: [wanted, ...entries].join(';') };
  }

  if (input.profileText.includes(MARK_BEGIN)) {
    return { kind: 'already-present', target };
  }
  const line = input.shell === 'fish'
    ? `fish_add_path ${input.binDir}`
    : `export PATH="${input.binDir}:$PATH"`;
  return {
    kind: 'profile-append',
    target,
    block: `${MARK_BEGIN}\n${line}\n${MARK_END}\n`,
  };
}
