/**
 * PAW Installer Shell Detection
 *
 * @fileoverview Decides which shell PAW is being activated for and which profile
 * file (or, on Windows, which environment store) its PATH edit belongs in. Pure:
 * the platform and the `$SHELL` value are passed in, so every branch is a unit
 * test and `main.ts` supplies the real `process.platform` / `process.env.SHELL`.
 * Windows always resolves to the per-user environment store rather than a profile
 * file, because that is where a persistent, no-admin PATH change lives there.
 *
 * @module @paw/installer/shell
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * A shell PAW knows how to activate its PATH in.
 */
export type Shell = 'powershell' | 'bash' | 'zsh' | 'fish' | 'unknown';

/**
 * The Windows per-user environment store — not a file, edited via the OS API.
 */
export const WINDOWS_ENV = 'HKCU\\Environment';

/**
 * Detect the shell from the platform and the `$SHELL` value. Windows resolves to
 * `powershell` (the registry strategy) regardless of an interactive bash, because
 * the persistent PATH lives in the per-user environment there.
 *
 * @param {string} platform - `process.platform` (e.g. `win32`, `darwin`, `linux`).
 * @param {string | undefined} shellEnv - `process.env.SHELL`, if set.
 * @returns {Shell} The detected shell.
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
 * The PATH-edit target for a shell: a profile file, or the Windows environment
 * store.
 *
 * @param {Shell} shell - The detected shell.
 * @param {string} home - The user's home directory.
 * @returns {string} The absolute profile path, or {@link WINDOWS_ENV}.
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
