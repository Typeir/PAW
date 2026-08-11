/**
 * PAW Installer Windows Environment Adapter
 *
 * @fileoverview {@link EnvironmentPort} for Windows per-user PATH, over
 * PowerShell `[Environment]::(Get|Set)EnvironmentVariable(...,'User')`. That API
 * write full value to `HKCU\Environment` (no truncation) and broadcast
 * `WM_SETTINGCHANGE` itself, so new shell see change without logout. `setx`
 * truncate PATH at 1024 chars. New value pass through child environment variable,
 * never interpolated into command, so path with quotes no break or inject. I/O —
 * excluded from coverage, driven only by installer shell on Windows.
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
 * Create Windows environment adapter.
 *
 * @returns {EnvironmentPort} Environment port over PowerShell.
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
