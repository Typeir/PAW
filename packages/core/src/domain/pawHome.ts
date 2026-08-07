/**
 * PAW Home
 *
 * @fileoverview Where PAW keeps the things that belong to the machine rather
 * than to a repository: the TLS identity, the installed binary, and the
 * machine-level settings that answer questions about the host rather than about
 * a project. `.paw/` is per-repo; none of those are.
 *
 * The location follows each platform's convention, and an explicit `PAW_HOME`
 * always wins so an operator can move it (or a test can point it at a temporary
 * directory). Pure over an injected environment, so the rules are unit-tested on
 * every platform from any platform.
 *
 * It lives in `core` because more than one shell needs it and none of them
 * should reach through another to get it — the installer decides where to put
 * the binary, the daemon decides where to keep its keys, and neither may depend
 * on the other. Being pure (it imports nothing at all) it satisfies core's rule
 * without exception.
 *
 * @module @paw/core/domain/pawHome
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { joinPath } from './paths.js';

/**
 * The environment slice the resolver reads.
 *
 * @interface HomeEnv
 * @property {string} [PAW_HOME] - An explicit override; always wins.
 * @property {string} [LOCALAPPDATA] - Windows per-user application data.
 * @property {string} [XDG_DATA_HOME] - Linux data directory, per the XDG basedir spec.
 * @property {string} [HOME] - The POSIX home directory.
 * @property {string} [USERPROFILE] - The Windows home directory.
 */
export interface HomeEnv {
  readonly PAW_HOME?: string;
  readonly LOCALAPPDATA?: string;
  readonly XDG_DATA_HOME?: string;
  readonly HOME?: string;
  readonly USERPROFILE?: string;
}

/**
 * Where PAW keeps machine-level state.
 *
 * @param {NodeJS.Platform | string} platform - The platform, as `os.platform()` reports it.
 * @param {HomeEnv} env - The environment.
 * @returns {string} The PAW home directory.
 * @throws {Error} When the platform offers no home directory to fall back on.
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
 * Where the installed `paw` binary and its launcher shims live inside a PAW
 * home. This is the directory `paw-setup path` puts on PATH.
 *
 * @param {string} home - The PAW home directory.
 * @returns {string} The bin directory.
 */
export function binDir(home: string): string {
  return joinPath([home, 'bin']);
}
