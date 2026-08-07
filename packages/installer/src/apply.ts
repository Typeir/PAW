/**
 * PAW Installer Apply
 *
 * @fileoverview The application layer for what is genuinely the installer's:
 * putting PAW's bin directory on PATH. It gathers the current state through the
 * ports, calls the pure planner to decide, and performs the decided edit,
 * returning the plan so a caller (or a `--dry-run`) can report exactly what
 * changed.
 *
 * Attaching a repository is deliberately not here. It moved to
 * `@paw/core`'s {@link applyInit}, because a terminal, a console and a desktop
 * dialog all attach repositories and three copies of that sequence would be
 * three chances to drift.
 *
 * @module @paw/installer/apply
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { planPathEdit, type PathEdit } from './path.js';
import { detectShell, profileTarget } from './shell.js';
import type { EnvironmentPort, FileSystemPort } from './ports.js';

/**
 * What PATH activation needs from the environment.
 *
 * @interface ActivateInput
 * @property {string} platform - `process.platform`.
 * @property {string | undefined} shellEnv - `process.env.SHELL`.
 * @property {string} home - The user's home directory.
 * @property {string} binDir - PAW's bin directory to put on PATH.
 * @property {boolean} [dryRun] - When true, compute the edit but perform no write.
 */
export interface ActivateInput {
  readonly platform: string;
  readonly shellEnv: string | undefined;
  readonly home: string;
  readonly binDir: string;
  readonly dryRun?: boolean;
}

/**
 * Put PAW's bin directory on PATH for the detected shell, and return the edit
 * performed (which may be a no-op when already present).
 *
 * @param {ActivateInput} input - Platform, shell, home, and bin directory.
 * @param {FileSystemPort} fs - Filesystem port (POSIX profile).
 * @param {EnvironmentPort} env - Environment port (Windows user PATH).
 * @returns {Promise<PathEdit>} The edit that was applied.
 */
export async function activatePath(
  input: ActivateInput,
  fs: FileSystemPort,
  env: EnvironmentPort,
): Promise<PathEdit> {
  const shell = detectShell(input.platform, input.shellEnv);
  const target = profileTarget(shell, input.home);
  const windows = shell === 'powershell';
  const currentPath = windows ? await env.getUserPath() : '';
  const profileText = windows ? '' : await fs.readText(target);

  const edit = planPathEdit({
    shell,
    home: input.home,
    binDir: input.binDir,
    currentPath,
    profileText,
  });

  if (input.dryRun === true) {
    return edit;
  }
  if (edit.kind === 'windows-registry') {
    await env.setUserPath(edit.newPath as string);
  } else if (edit.kind === 'profile-append') {
    await fs.appendText(edit.target, edit.block as string);
  }
  return edit;
}

