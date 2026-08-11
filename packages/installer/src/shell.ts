/**
 * PAW Installer Shell Detection
 *
 * @fileoverview Decide which shell PAW activate for, and which profile
 * file (or, on Windows, which environment store) its PATH edit belong in. Pure:
 * platform and `$SHELL` value pass in, so every branch be unit
 * test and `main.ts` supply actual `process.platform` / `process.env.SHELL`.
 * Windows always resolve to per-user environment store, not a profile
 * file, because persistent no-admin PATH changes are stored there.
 *
 * @module @paw/installer/shell
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Shell PAW know how activate its PATH in.
 */
export type Shell = 'powershell' | 'bash' | 'zsh' | 'fish' | 'unknown';

/**
 * Windows per-user environment store — no file, edit via OS API.
 */
export const WINDOWS_ENV = 'HKCU\\Environment';

/**
 * Detect shell from platform and `$SHELL` value. Windows resolve to
 * `powershell` (registry strategy) no matter interactive bash, because
 * persistent PATH is stored in the per-user environment there.
 *
 * @param {string} platform - `process.platform` (e.g. `win32`, `darwin`, `linux`).
 * @param {string | undefined} shellEnv - `process.env.SHELL`, if set.
 * @returns {Shell} Detected shell.
 */
export function detectShell(platform: string, shellEnv: string | undefined): Shell {
  if (platform === 'win32') {
    return 'powershell';
  }
  if (!shellEnv) {
    return 'unknown';
  }
  const parts = shellEnv.split('/');
  const base = parts[parts.length - 1];
  if (base.includes('zsh')) {
    return 'zsh';
  }
  if (base.includes('bash')) {
    return 'bash';
  }
  if (base.includes('fish')) {
    return 'fish';
  }
  return 'unknown';
}

/**
 * PATH-edit target for shell: profile file, or Windows environment
 * store.
 *
 * @param {Shell} shell - Detected shell.
 * @param {string} home - User home directory.
 * @returns {string} Absolute profile path, or {@link WINDOWS_ENV}.
 */
export function profileTarget(shell: Shell, home: string): string {
  switch (shell) {
    case 'powershell':
      return WINDOWS_ENV;
    case 'zsh':
      return `${home}/.zshrc`;
    case 'bash':
      return `${home}/.bashrc`;
    case 'fish':
      return `${home}/.config/fish/config.fish`;
    case 'unknown':
      return `${home}/.profile`;
  }
}
