/**
 * PAW Home
 *
 * @fileoverview Where PAW keeps the things that belong to the machine rather
 * than to a repository. `.paw/` is a per-repo install directory; a TLS identity
 * is not per-repo — one operator on one machine has one local CA, and every
 * repository they serve is issued from it. Putting the key material in a repo
 * would also mean a stray `git add` publishes a private key.
 *
 * The location follows each platform's convention, and an explicit `PAW_HOME`
 * always wins so an operator can move it (or a test can point it at a temporary
 * directory). Pure over an injected environment, so the rules are unit-tested on
 * every platform from any platform.
 *
 * @module @paw/daemon/pawHome
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

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
 * Join path segments with forward slashes, which every platform's filesystem
 * API accepts and which keeps the resolver's output comparable in a test.
 *
 * @param {readonly string[]} parts - The segments.
 * @returns {string} The joined path.
 */
function joinPath(parts: readonly string[]): string {
  return parts
    .map((part) => part.replace(/\\/g, '/').replace(/\/+$/, ''))
    .filter((part) => part !== '')
    .join('/');
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
 * Where the TLS identity lives inside a PAW home.
 *
 * @param {string} home - The PAW home directory.
 * @returns {string} The identity directory.
 */
export function identityDir(home: string): string {
  return joinPath([home, 'identity']);
}

/**
 * The identity's files.
 *
 * @interface IdentityPaths
 * @property {string} dir - The directory holding them.
 * @property {string} caCert - The local CA certificate.
 * @property {string} caKey - The local CA private key.
 * @property {string} leafCert - The server certificate.
 * @property {string} leafKey - The server private key.
 * @property {string} meta - The metadata sidecar.
 */
export interface IdentityPaths {
  readonly dir: string;
  readonly caCert: string;
  readonly caKey: string;
  readonly leafCert: string;
  readonly leafKey: string;
  readonly meta: string;
}

/**
 * Every path the identity occupies.
 *
 * @param {string} home - The PAW home directory.
 * @returns {IdentityPaths} The paths.
 */
export function identityPaths(home: string): IdentityPaths {
  const dir = identityDir(home);
  return {
    dir,
    caCert: joinPath([dir, 'ca.crt']),
    caKey: joinPath([dir, 'ca.key']),
    leafCert: joinPath([dir, 'leaf.crt']),
    leafKey: joinPath([dir, 'leaf.key']),
    meta: joinPath([dir, 'meta.json']),
  };
}
