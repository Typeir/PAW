/**
 * PAW Installer Apply
 *
 * @fileoverview App layer. Puts PAW bin dir on PATH. Gathers current state through ports, calls pure planner to decide, does decided edit, hands back plan so caller (or `--dry-run`) reports exact change.
 *
 * Repository attach lives in `@paw/core`'s {@link applyInit}. Terminal, console and desktop dialog all attach repository; one shared sequence avoids three copies drifting apart.
 *
 * @module @paw/installer/apply
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { planPathEdit, type PathEdit } from './path.js';
import { planShims, type Launcher, type ShimWrite } from './shims.js';
import { detectShell, profileTarget } from './shell.js';
import type { EnvironmentPort, FileSystemPort } from './ports.js';

/**
 * What PATH activation need from environment.
 *
 * @interface ActivateInput
 * @property {string} platform - `process.platform`.
 * @property {string | undefined} shellEnv - `process.env.SHELL`.
 * @property {string} home - User home dir.
 * @property {string} binDir - PAW bin dir to put on PATH.
 * @property {boolean} [dryRun] - When true, compute edit but write nothing.
 */
export interface ActivateInput {
  readonly platform: string;
  readonly shellEnv: string | undefined;
  readonly home: string;
  readonly binDir: string;
  readonly dryRun?: boolean;
}

/**
 * Put PAW bin dir on PATH for detected shell, return edit done (no-op when already present).
 *
 * @param {ActivateInput} input - Platform, shell, home, and bin dir.
 * @param {FileSystemPort} fs - Filesystem port (POSIX profile).
 * @param {EnvironmentPort} env - Environment port (Windows user PATH).
 * @returns {Promise<PathEdit>} Edit get applied.
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
 * What shim install need from environment.
 *
 * @interface InstallShimsInput
 * @property {string} platform - `process.platform`.
 * @property {string} binDir - Dir shims go in; created when absent.
 * @property {readonly Launcher[]} launchers - Commands to shim.
 * @property {boolean} [dryRun] - When true, compute the writes but perform none.
 */
export interface InstallShimsInput {
  readonly platform: string;
  readonly binDir: string;
  readonly launchers: readonly Launcher[];
  readonly dryRun?: boolean;
}

/**
 * Writes the launcher shims into bin dir so PATH entry activates the dir holding `paw`. Ensures dir, writes each planned shim, sets executable bit on sh ones. Returns plan for reporting.
 *
 * @param {InstallShimsInput} input - Platform, bin dir, launchers.
 * @param {FileSystemPort} fs - Filesystem port.
 * @returns {Promise<ShimWrite[]>} Shims written (or planned, under dry-run).
 */
export async function installShims(
  input: InstallShimsInput,
  fs: FileSystemPort,
): Promise<ShimWrite[]> {
  const writes = planShims(input.platform, input.binDir, input.launchers);
  if (input.dryRun === true) {
    return writes;
  }
  await fs.ensureDir(input.binDir);
  for (const shim of writes) {
    await fs.writeText(shim.path, shim.content);
    if (shim.executable) {
      await fs.setExecutable(shim.path);
    }
  }
  return writes;
}

