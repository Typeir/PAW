/**
 * PAW Console Launcher
 *
 * @fileoverview Decides which surface `paw ui` opens. The Electron viewer is
 * tried first, spawned on the daemon's URL and certificate fingerprint; the
 * browser is the fallback when the shell is missing, its binary is absent, or
 * the spawn dies inside the grace window. Effects are injected seams.
 *
 * @module @paw/cli/application/electronLauncher
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { join } from 'node:path';

/**
 * How long a spawned shell must stay alive before it counts as launched.
 * Electron fails fast when it cannot boot — missing binary, broken bundle,
 * display errors — so an exit inside this window falls back to the browser.
 */
export const ELECTRON_GRACE_MS = 2000;

/**
 * The slice of a spawned child the launcher watches.
 *
 * @interface ChildLike
 * @property {(event: 'error' | 'exit', listener: () => void) => void} once - Subscribe once to spawn failure or exit.
 * @property {() => void} unref - Detach the child from this process's lifetime.
 */
export interface ChildLike {
  once(event: 'error' | 'exit', listener: () => void): void;
  unref(): void;
}

/**
 * Effects the launcher needs.
 *
 * @interface LauncherSeams
 * @property {(path: string) => boolean} exists - Whether a path exists.
 * @property {(electronDir: string) => string | null} electronBinOf - Electron binary path resolved from the shell package's own dependencies, or null when not installed.
 * @property {(bin: string, args: readonly string[]) => ChildLike} spawnShell - Spawn the shell, detached.
 * @property {(url: string) => void} openWeb - Open the console URL in the default browser.
 * @property {number} [graceMs] - Override of {@link ELECTRON_GRACE_MS}.
 */
export interface LauncherSeams {
  exists(path: string): boolean;
  electronBinOf(electronDir: string): string | null;
  spawnShell(bin: string, args: readonly string[]): ChildLike;
  openWeb(url: string): void;
  readonly graceMs?: number;
}

/**
 * Where the desktop shell lives relative to the CLI package: the sibling
 * `electron` package and its bundled main.
 *
 * @param {string} cliRoot - The CLI package root.
 * @returns {{ dir: string; main: string }} Shell package directory and bundle path.
 */
export function shellPathsFor(cliRoot: string): { dir: string; main: string } {
  const dir = join(cliRoot, '..', 'electron');
  return { dir, main: join(dir, 'dist', 'main.cjs') };
}

/**
 * Open the console: desktop shell first, browser on any failure. Resolves with
 * the surface that ended up showing the console.
 *
 * @param {string} url - Console URL, token fragment included.
 * @param {string} fingerprint - Daemon certificate fingerprint the shell must pin.
 * @param {string} cliRoot - The CLI package root, to locate the shell.
 * @param {LauncherSeams} seams - Injected effects.
 * @returns {Promise<'electron' | 'web'>} Surface that opened.
 */
export function openConsole(
  url: string,
  fingerprint: string,
  cliRoot: string,
  seams: LauncherSeams,
): Promise<'electron' | 'web'> {
  const { dir, main } = shellPathsFor(cliRoot);
  const bin = seams.exists(main) ? seams.electronBinOf(dir) : null;
  if (bin === null || !seams.exists(bin)) {
    seams.openWeb(url);
    return Promise.resolve('web');
  }
  const child = seams.spawnShell(bin, [main, `--url=${url}`, `--fingerprint=${fingerprint}`]);
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.unref();
        resolve('electron');
      }
    }, seams.graceMs ?? ELECTRON_GRACE_MS);
    const fail = (): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        seams.openWeb(url);
        resolve('web');
      }
    };
    child.once('error', fail);
    child.once('exit', fail);
  });
}
