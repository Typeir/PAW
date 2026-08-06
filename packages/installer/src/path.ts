/**
 * PAW Installer PATH Planner
 *
 * @fileoverview Decides how to put PAW's bin directory on PATH for a detected
 * shell, and returns that decision as a value — a {@link PathEdit} — rather than
 * performing it. The apply step executes it through a port, so the whole decision
 * is a pure unit test. Two strategies: on Windows, replace the per-user `Path` in
 * the environment store (persisted and broadcast by the OS API — never `setx`,
 * which truncates PATH at 1024 characters and can corrupt it); on POSIX, append a
 * single marker-delimited block to the shell profile, idempotent so re-running
 * never double-adds. When the entry is already present, the plan says so and
 * changes nothing.
 *
 * @module @paw/installer/path
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { profileTarget, type Shell } from './shell.js';

/**
 * The marker beginning PAW's block in a POSIX profile (the conda/rustup convention).
 */
export const MARK_BEGIN = '# >>> paw >>>';

/**
 * The marker ending PAW's block in a POSIX profile.
 */
export const MARK_END = '# <<< paw <<<';

/**
 * The kind of PATH edit to perform.
 */
export type PathEditKind = 'windows-registry' | 'profile-append' | 'already-present';

/**
 * A planned PATH edit — a value the apply step executes.
 *
 * @interface PathEdit
 * @property {PathEditKind} kind - Which strategy, or already-present.
 * @property {string} target - The profile path, or the Windows environment store.
 * @property {string} [block] - The marker block to append (profile-append only).
 * @property {string} [newPath] - The new `Path` value to persist (windows-registry only).
 */
export interface PathEdit {
  readonly kind: PathEditKind;
  readonly target: string;
  readonly block?: string;
  readonly newPath?: string;
}

/**
 * The inputs the planner needs.
 *
 * @interface PathPlanInput
 * @property {Shell} shell - The detected shell.
 * @property {string} home - The user's home directory.
 * @property {string} binDir - PAW's bin directory to add to PATH.
 * @property {string} currentPath - The current user `Path` value (Windows only; `;`-separated).
 * @property {string} profileText - The current profile file contents (POSIX only).
 */
export interface PathPlanInput {
  readonly shell: Shell;
  readonly home: string;
  readonly binDir: string;
  readonly currentPath: string;
  readonly profileText: string;
}

/**
 * Plan the PATH edit for the given shell and current state.
 *
 * @param {PathPlanInput} input - The detected shell and current PATH/profile state.
 * @returns {PathEdit} What to change, or that nothing needs changing.
 */
export function planPathEdit(input: PathPlanInput): PathEdit {
  const target = profileTarget(input.shell, input.home);

  if (input.shell === 'powershell') {
    const entries = input.currentPath.split(';').filter((e) => e.length > 0);
    if (entries.includes(input.binDir)) {
      return { kind: 'already-present', target };
    }
    return { kind: 'windows-registry', target, newPath: [input.binDir, ...entries].join(';') };
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
