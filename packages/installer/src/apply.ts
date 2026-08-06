/**
 * PAW Installer Apply
 *
 * @fileoverview The application layer: it gathers the current state through the
 * ports, calls the pure planners to decide, and performs the decided edit — PATH
 * activation and per-repo init. It reads and writes only through {@link
 * FileSystemPort} / {@link EnvironmentPort}, so it is unit-tested against fakes and
 * `main.ts` supplies the real adapters. It returns the plan it executed so a caller
 * (or a `--dry-run`) can report exactly what changed.
 *
 * @module @paw/installer/apply
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { dirname } from 'node:path';
import { planPathEdit, type PathEdit } from './path.js';
import { planInit, type InitPlan } from './scaffold.js';
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

/**
 * Attach PAW to a repo root by writing the scaffold, returning the plan executed.
 *
 * @param {string} root - The repo root (from `findRepoRoot`).
 * @param {FileSystemPort} fs - Filesystem port.
 * @returns {Promise<InitPlan>} The plan that was written.
 */
export async function applyInit(root: string, fs: FileSystemPort): Promise<InitPlan> {
  const plan = planInit(root);
  for (const write of plan.writes) {
    await fs.ensureDir(dirname(write.path));
    await fs.writeText(write.path, write.content);
    if (write.executable) {
      await fs.setExecutable(write.path);
    }
  }
  return plan;
}
