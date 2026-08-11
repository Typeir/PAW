/**
 * PAW Daemon Endpoint
 *
 * @fileoverview One `pawd` listens; hooks and CLI connect
 * (doc 10 §4). `node:net` exposes Windows named pipes and Unix domain sockets
 * through one API; single {@link socketPath} covers both — pipe in
 * kernel namespace on win32, short filesystem socket under runtime dir on
 * POSIX (`sun_path` cap ~104 bytes). Project id be hash of root;
 * two checkouts share no daemon, no token. Pure and parameterised: platform and
 * runtime dirs be inputs.
 *
 * @module @paw/daemon/infrastructure/endpoint
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * Platform-and-runtime inputs {@link socketPath} need.
 *
 * @interface EndpointEnv
 * @property {NodeJS.Platform} platform - OS, decide pipe vs socket.
 * @property {string | undefined} xdgRuntimeDir - `$XDG_RUNTIME_DIR`, prefer on POSIX.
 * @property {string} tmpdir - Fallback dir for POSIX socket.
 */
export interface EndpointEnv {
  readonly platform: NodeJS.Platform;
  readonly xdgRuntimeDir: string | undefined;
  readonly tmpdir: string;
}

/**
 * Short, stable id for project root — first 12 hex of
 * SHA-256 of case-normalised, forward-slashed root.
 *
 * @param {string} projectRoot - Absolute project root.
 * @returns {string} 12-char id name socket and namespace state.
 */
export function projectId(projectRoot: string): string {
  return createHash('sha256')
    .update(projectRoot.toLowerCase().replace(/\\/g, '/'))
    .digest('hex')
    .slice(0, 12);
}

/**
 * Endpoint daemon bind, client connect.
 *
 * @param {string} projectRoot - Absolute project root.
 * @param {EndpointEnv} env - Platform and runtime directories.
 * @returns {string} Named pipe on win32, `.sock` path on POSIX.
 */
export function socketPath(projectRoot: string, env: EndpointEnv): string {
  const id = projectId(projectRoot);
  if (env.platform === 'win32') {
    return `\\\\.\\pipe\\paw-${id}`;
  }
  return join(env.xdgRuntimeDir ?? env.tmpdir, `paw-${id}.sock`);
}

/**
 * Handshake token file — 32 random bytes pawd write at `0600`, every
 * client must present in first frame (doc 10 §4).
 *
 * @param {string} pawDir - Project's `.paw` directory.
 * @returns {string} Token path.
 */
export function tokenPath(pawDir: string): string {
  return join(pawDir, 'daemon.token');
}

/**
 * Autostart lock file — exclusive-create, let only one of many
 * concurrent hooks spawn daemon (doc 10 §9a).
 *
 * @param {string} pawDir - Project's `.paw` directory.
 * @returns {string} Lock path.
 */
export function lockPath(pawDir: string): string {
  return join(pawDir, 'daemon.lock');
}
