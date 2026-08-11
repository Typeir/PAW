/**
 * PAW Installer Shim Planner
 *
 * @fileoverview Decide launcher shims `paw-setup path` put into bin dir, as values — apply step write them through filesystem port. Without shims PATH edit activate empty directory, no shell find `paw`. npm convention: on Windows write three flavors per launcher — extensionless `#!/bin/sh` for Git Bash (bash resolve bare name to no-extension file, never `.cmd`), `.cmd` for cmd, `.ps1` for PowerShell. POSIX need only sh one. Each shim exec `node <entry>` forwarding arguments; entry path backslashed inside `.cmd`/`.ps1`, forward-slashed in sh.
 *
 * @module @paw/installer/shims
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * One launcher a shim trio point at.
 *
 * @interface Launcher
 * @property {string} name - Command name shells resolve (`paw`).
 * @property {string} entry - Absolute path of `.mjs` entry the shim run.
 */
export interface Launcher {
  readonly name: string;
  readonly entry: string;
}

/**
 * One planned shim file.
 *
 * @interface ShimWrite
 * @property {string} path - Where the shim go, inside bin dir.
 * @property {string} content - Shim body.
 * @property {boolean} executable - True for sh shim; POSIX need bit.
 */
export interface ShimWrite {
  readonly path: string;
  readonly content: string;
  readonly executable: boolean;
}

/**
 * Plan shims for bin dir. Windows get sh + cmd + ps1 per launcher (Git Bash, cmd, PowerShell each resolve their own); other platforms get sh only.
 *
 * @param {string} platform - `process.platform`.
 * @param {string} binDir - Directory the shims go in.
 * @param {readonly Launcher[]} launchers - Commands to shim.
 * @returns {ShimWrite[]} The files to write.
 */
export function planShims(
  platform: string,
  binDir: string,
  launchers: readonly Launcher[],
): ShimWrite[] {
  const writes: ShimWrite[] = [];
  for (const { name, entry } of launchers) {
    const forward = entry.replaceAll('\\', '/');
    writes.push({
      path: `${binDir}/${name}`,
      content: `#!/bin/sh\nexec node "${forward}" "$@"\n`,
      executable: true,
    });
    if (platform === 'win32') {
      const back = entry.replaceAll('/', '\\');
      writes.push({
        path: `${binDir}/${name}.cmd`,
        content: `@echo off\r\nnode "${back}" %*\r\n`,
        executable: false,
      });
      writes.push({
        path: `${binDir}/${name}.ps1`,
        content: `& node "${back}" @args\nexit $LASTEXITCODE\n`,
        executable: false,
      });
    }
  }
  return writes;
}
