/**
 * PAW Bootstrap Utilities
 *
 * @fileoverview Cross-platform helpers for bootstrapping the PAW CLI from
 * source. These functions are shared between the standalone `paw install`
 * flow and the `ik setup` contributor setup command so both stay in sync.
 *
 * Bootstrap pipeline:
 *   1. Install PAW npm dependencies (`npm install` inside `.github/PAW/`)
 *   2. Compile the CLI bundle (`node build.mjs`)
 *   3. Caller runs `paw sync` to populate `.paw/` and generate `hooks.json`
 *
 * @module .github/PAW/pawBootstrap
 * @author Typeir
 * @version 1.0.0
 * @since 3.0.0
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PAW_CORE_DIR } from './pawPaths';

/**
 * Absolute path to the compiled CLI entry point.
 */
export const PAW_CLI_PATH = path.join(PAW_CORE_DIR, 'dist', 'cli.mjs');

/**
 * Installs PAW's own npm dependencies inside the PAW package directory.
 *
 * @returns {string | null} Error message if installation failed, null on success.
 */
export function installPawDependencies(): string | null {
  const result = spawnSync('npm', ['install'], {
    cwd: PAW_CORE_DIR,
    stdio: 'pipe',
    shell: true,
  });
  if (result.status !== 0 || result.error) {
    const stderr = result.stderr?.toString().trim() ?? result.error?.message ?? 'unknown error';
    return `PAW npm install failed: ${stderr}`;
  }
  return null;
}

/**
 * Compiles the PAW CLI bundle by running `node build.mjs` inside the PAW
 * package directory. Requires PAW npm dependencies to be installed first.
 *
 * @returns {string | null} Error message if the build failed, null on success.
 */
export function buildPawCli(): string | null {
  const buildScript = path.join(PAW_CORE_DIR, 'build.mjs');
  const result = spawnSync('node', [buildScript], {
    cwd: PAW_CORE_DIR,
    stdio: 'pipe',
  });
  if (result.status !== 0 || result.error) {
    const stderr = result.stderr?.toString().trim() ?? result.error?.message ?? 'unknown error';
    return `PAW build failed: ${stderr}`;
  }
  return null;
}

/**
 * Ensures the compiled PAW CLI exists. Installs dependencies and builds from
 * source when the artifact is absent. Skips both steps when already built.
 *
 * @returns {string | null} Error message if preparation failed, null on success.
 */
export function ensurePawCli(): string | null {
  if (existsSync(PAW_CLI_PATH)) {
    return null;
  }
  const installErr = installPawDependencies();
  if (installErr) {
    return installErr;
  }
  return buildPawCli();
}
