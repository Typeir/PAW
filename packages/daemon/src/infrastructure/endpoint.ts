/**
 * PAW Daemon Endpoint
 *
 * @fileoverview Where the one resident `pawd` listens and hooks/CLI connect
 * (doc 10 §4). `node:net` speaks Windows named pipes and Unix domain sockets
 * through one API, so a single {@link socketPath} covers both — a pipe in the
 * kernel namespace on win32, a short filesystem socket under the runtime dir on
 * POSIX (kept short because `sun_path` is capped at ~104 bytes). The project id
 * is a hash of the root, so two checkouts never share a daemon or a token.
 *
 * Pure and parameterised: the platform and runtime dirs are inputs, not reads of
 * `process`, so both platforms are covered on either host.
 *
 * @module @paw/daemon/infrastructure/endpoint
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * The platform-and-runtime inputs {@link socketPath} needs.
 *
 * @interface EndpointEnv
 * @property {NodeJS.Platform} platform - The OS, deciding pipe vs socket.
 * @property {string | undefined} xdgRuntimeDir - `$XDG_RUNTIME_DIR`, preferred on POSIX.
 * @property {string} tmpdir - Fallback directory for the POSIX socket.
 */
export interface EndpointEnv {
  readonly platform: NodeJS.Platform;
  readonly xdgRuntimeDir: string | undefined;
  readonly tmpdir: string;
}

/**
 * A short, stable identifier for a project root — the first 12 hex of the
 * SHA-256 of the case-normalised, forward-slashed root.
 *
 * @param {string} projectRoot - Absolute project root.
 * @returns {string} The 12-char id used to name the socket and namespace state.
 */
export function projectId(projectRoot: string): string {
  return createHash('sha256')
    .update(projectRoot.toLowerCase().replace(/\\/g, '/'))
    .digest('hex')
    .slice(0, 12);
}

/**
 * The endpoint the daemon binds and clients connect to.
 *
 * @param {string} projectRoot - Absolute project root.
 * @param {EndpointEnv} env - Platform and runtime directories.
 * @returns {string} A named pipe on win32, a `.sock` path on POSIX.
 */
export function socketPath(projectRoot: string, env: EndpointEnv): string {
  const id = projectId(projectRoot);
  if (env.platform === 'win32') {
    return `\\\\.\\pipe\\paw-${id}`;
  }
  return join(env.xdgRuntimeDir ?? env.tmpdir, `paw-${id}.sock`);
}

/**
 * The handshake token file — 32 random bytes pawd writes at `0600` and every
 * client must present in its first frame (doc 10 §4).
 *
 * @param {string} pawDir - The project's `.paw` directory.
 * @returns {string} The token path.
 */
export function tokenPath(pawDir: string): string {
  return join(pawDir, 'daemon.token');
}

/**
 * The autostart lock file — the exclusive-create seam that lets only one hook of
 * a thundering herd spawn the daemon (doc 10 §9a).
 *
 * @param {string} pawDir - The project's `.paw` directory.
 * @returns {string} The lock path.
 */
export function lockPath(pawDir: string): string {
  return join(pawDir, 'daemon.lock');
}
