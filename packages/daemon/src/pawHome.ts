/**
 * PAW Identity Paths
 *
 * @fileoverview Where the daemon's TLS identity sits inside the machine's PAW
 * home. A TLS identity is not per-repo — one operator on one machine has one
 * local CA, and every repository they serve is issued from it. Putting the key
 * material in a repo would also mean a stray `git add` publishes a private key.
 *
 * {@link pawHome} itself lives in `@paw/core` and is re-exported here: the
 * installer needs it to decide where the binary goes and must not depend on the
 * daemon to ask. What stays here is the part that is genuinely the daemon's —
 * which files an identity is made of.
 *
 * @module @paw/daemon/pawHome
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

export { binDir, pawHome } from '@paw/core';
export type { HomeEnv } from '@paw/core';

/**
 * Where the TLS identity lives inside a PAW home.
 *
 * @param {string} home - The PAW home directory.
 * @returns {string} The identity directory.
 */
export function identityDir(home: string): string {
  return `${home}/identity`;
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
    caCert: `${dir}/ca.crt`,
    caKey: `${dir}/ca.key`,
    leafCert: `${dir}/leaf.crt`,
    leafKey: `${dir}/leaf.key`,
    meta: `${dir}/meta.json`,
  };
}
