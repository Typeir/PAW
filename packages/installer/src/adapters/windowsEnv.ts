/**
 * PAW Installer Windows Environment Adapter
 *
 * @fileoverview The real {@link EnvironmentPort} for the Windows per-user PATH,
 * over PowerShell's `[Environment]::(Get|Set)EnvironmentVariable(...,'User')`. That
 * API writes the full value to `HKCU\Environment` (no truncation) and broadcasts
 * `WM_SETTINGCHANGE` itself, so new shells see the change without a logout — which
 * is why this uses it rather than `setx` (which truncates PATH at 1024 chars). The
 * new value is passed through a child environment variable, never interpolated into
 * the command, so a path with quotes cannot break or inject. I/O — excluded from
 * coverage, driven only by the installer shell on Windows.
 *
 * @module @paw/installer/adapters/windowsEnv
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { createNodeProcess } from '@paw/adapters';
import type { EnvironmentPort } from '../ports.js';

const PS = 'powershell';
const NO_PROFILE = ['-NoProfile', '-NonInteractive', '-Command'];

/**
 * Create the Windows environment adapter.
 *
 * @returns {EnvironmentPort} An environment port over PowerShell.
 */
export function createWindowsEnv(): EnvironmentPort {
  const proc = createNodeProcess();
  return {
    async getUserPath() {
      const res = await proc.run(PS, [
        ...NO_PROFILE,
        "[Environment]::GetEnvironmentVariable('Path','User')",
      ]);
      return res.stdout.trim();
    },
    async setUserPath(value) {
      await proc.run(
        PS,
        [...NO_PROFILE, "[Environment]::SetEnvironmentVariable('Path',$env:PAW_NEW_PATH,'User')"],
        { env: { ...process.env, PAW_NEW_PATH: value } },
      );
    },
  };
}
