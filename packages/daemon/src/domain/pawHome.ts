/**
 * PAW Identity Paths
 *
 * @fileoverview Find daemon TLS identity inside machine PAW home. One operator
 * on one machine hold one local CA; every repo serve issue from it.
 * {@link pawHome} live in `@paw/core`, re-export here for installer, who read
 * it to place binary. This module define which files one identity comprise.
 *
 * @module @paw/daemon/pawHome
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

export { binDir, pawHome } from '@paw/core';
export type { HomeEnv } from '@paw/core';

/**
 * Where TLS identity live inside PAW home.
 *
 * @param {string} home - PAW home directory.
 * @returns {string} Identity directory.
 */
export function identityDir(home: string): string {
  return `${home}/identity`;
}

/**
 * Identity files.
 *
 * @interface IdentityPaths
 * @property {string} dir - Directory holding them.
 * @property {string} caCert - Local CA certificate.
 * @property {string} caKey - Local CA private key.
 * @property {string} leafCert - Server certificate.
 * @property {string} leafKey - Server private key.
 * @property {string} meta - Metadata sidecar.
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
 * Every path identity occupy.
 *
 * @param {string} home - PAW home directory.
 * @returns {IdentityPaths} Paths.
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
