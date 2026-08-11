/**
 * PAW Home
 *
 * @fileoverview Resolve PAW machine-level home. Resolve PAW home. Directory hold
 * TLS identity, installed binary, host settings. Per-repo `.paw/` separate thing.
 * Follow platform convention. Explicit `PAW_HOME` overrides. Pure over injected
 * env. Unit-tested on every platform from any platform. Lives in `core`.
 * Import nothing.
 *
 * @module @paw/core/domain/pawHome
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { joinPath } from './paths.js';

/**
 * Environment slice resolver reads.
 *
 * @interface HomeEnv
 * @property {string} [PAW_HOME] - Explicit override; checked before platform detection.
 * @property {string} [LOCALAPPDATA] - Windows per-user app data.
 * @property {string} [XDG_DATA_HOME] - Linux data dir, per XDG basedir spec.
 * @property {string} [HOME] - POSIX home dir.
 * @property {string} [USERPROFILE] - Windows home dir.
 */
export interface HomeEnv {
  readonly PAW_HOME?: string;
  readonly LOCALAPPDATA?: string;
  readonly XDG_DATA_HOME?: string;
  readonly HOME?: string;
  readonly USERPROFILE?: string;
}

/**
 * Where PAW keep machine-level state.
 *
 * @param {NodeJS.Platform | string} platform - Platform, as `os.platform()` report.
 * @param {HomeEnv} env - Environment.
 * @returns {string} PAW home directory.
 * @throws {Error} When platform give no home directory to fall back on.
 */
export function pawHome(platform: string, env: HomeEnv): string {
  if (env.PAW_HOME !== undefined && env.PAW_HOME !== '') {
    return joinPath([env.PAW_HOME]);
  }
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA ?? env.USERPROFILE;
    if (base === undefined || base === '') {
      throw new Error('PAW home: neither LOCALAPPDATA nor USERPROFILE is set');
    }
    return joinPath([base, 'paw']);
  }
  const home = env.HOME;
  if (platform === 'darwin') {
    if (home === undefined || home === '') {
      throw new Error('PAW home: HOME is not set');
    }
    return joinPath([home, 'Library', 'Application Support', 'paw']);
  }
  if (env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME !== '') {
    return joinPath([env.XDG_DATA_HOME, 'paw']);
  }
  if (home === undefined || home === '') {
    throw new Error('PAW home: neither XDG_DATA_HOME nor HOME is set');
  }
  return joinPath([home, '.local', 'share', 'paw']);
}

/**
 * Where installed `paw` binary and launcher shims live inside PAW home.
 * Directory `paw-setup path` put on PATH.
 *
 * @param {string} home - PAW home directory.
 * @returns {string} Bin directory.
 */
export function binDir(home: string): string {
  return joinPath([home, 'bin']);
}