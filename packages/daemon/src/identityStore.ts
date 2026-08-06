/**
 * PAW Identity Store
 *
 * @fileoverview Turning the identity policy into a certificate the daemon can
 * actually serve: read what is on disk, decide, issue what is missing, persist
 * it, and hand back the leaf. Pure over {@link IdentityIo} and
 * {@link IdentityIssuer}, so every path — first boot, leaf renewal, expired CA,
 * a half-deleted directory, a sidecar written by a future version — is a unit
 * test rather than a thing that happens once on someone's machine in November.
 *
 * Two invariants this file exists to hold:
 *
 * A reissued CA resets `trusted` to false. The operator trusted a *specific*
 * certificate; a new one carries none of that, and quietly inheriting the flag
 * would suppress the very warning that tells them to approve the replacement.
 *
 * A renewed leaf keeps the CA untouched. That is the whole reason for the two-
 * tier chain: the server certificate rotates every ninety days without ever
 * asking the operator to open their trust store again.
 *
 * @module @paw/daemon/identityStore
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  META_VERSION,
  caExpiringSoon,
  decideIdentity,
  isUsableMeta,
  trustAdvice,
  type IdentityAction,
  type IdentityMeta,
} from './identity.js';
import type { IdentityPaths } from './pawHome.js';

/**
 * A freshly issued certificate and its key.
 *
 * @interface IssuedCert
 * @property {string} cert - The certificate, PEM.
 * @property {string} key - The private key, PKCS#8 PEM.
 * @property {string} fingerprint - SHA-256 of the certificate, `SHA256:AA:BB:…`.
 * @property {string} notAfter - When it expires, ISO-8601.
 */
export interface IssuedCert {
  readonly cert: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly notAfter: string;
}

/**
 * Reading and writing the identity, with secrets written as secrets.
 *
 * @interface IdentityIo
 * @property {(dir: string) => Promise<void>} ensureDir - Create the identity directory, restricted to this account.
 * @property {(path: string) => Promise<string | null>} readText - Read a file, or null when it is absent.
 * @property {(path: string, text: string) => Promise<void>} writeSecret - Write a private key, then prove only this account can read it.
 * @property {(path: string, text: string) => Promise<void>} writePublic - Write a certificate or sidecar.
 */
export interface IdentityIo {
  ensureDir(dir: string): Promise<void>;
  readText(path: string): Promise<string | null>;
  writeSecret(path: string, text: string): Promise<void>;
  writePublic(path: string, text: string): Promise<void>;
}

/**
 * Minting certificates.
 *
 * @interface IdentityIssuer
 * @property {(user: string, host: string, now: Date) => Promise<IssuedCert>} issueCa - Mint a name-constrained local CA.
 * @property {(caCert: string, caKey: string, now: Date) => Promise<IssuedCert>} issueLeaf - Mint a loopback server certificate from it.
 */
export interface IdentityIssuer {
  issueCa(user: string, host: string, now: Date): Promise<IssuedCert>;
  issueLeaf(caCert: string, caKey: string, now: Date): Promise<IssuedCert>;
}

/**
 * Who the CA is being issued for, so its subject names the machine it belongs to.
 *
 * @interface Operator
 * @property {string} user - The account name.
 * @property {string} host - The machine name.
 */
export interface Operator {
  readonly user: string;
  readonly host: string;
}

/**
 * The identity the daemon serves with.
 *
 * @interface ServerIdentity
 * @property {string} cert - The server certificate, PEM.
 * @property {string} key - Its private key, PEM.
 * @property {string} caCert - The CA certificate, PEM — what a client pins or trusts.
 * @property {string} caCertPath - Where that CA sits, for the trust instructions.
 * @property {IdentityMeta} meta - What is now recorded about the identity.
 * @property {IdentityAction} action - What this load had to do to produce it.
 */
export interface ServerIdentity {
  readonly cert: string;
  readonly key: string;
  readonly caCert: string;
  readonly caCertPath: string;
  readonly meta: IdentityMeta;
  readonly action: IdentityAction;
}

/**
 * The stored metadata, or null when there is none this daemon can use.
 *
 * A sidecar that will not parse, or that a future version wrote, is treated as
 * absent — which reissues. The alternative is serving against metadata that does
 * not describe the files on disk, and a fingerprint the operator was told to
 * compare against is worth nothing if it might be stale. The caller is handed
 * the resulting {@link IdentityAction} and reports it, so a reissue is announced
 * rather than silent.
 *
 * @param {string | null} raw - The sidecar's contents, or null when absent.
 * @returns {IdentityMeta | null} The metadata, or null.
 */
export function readMeta(raw: string | null): IdentityMeta | null {
  if (raw === null) {
    return null;
  }
  const parsed: unknown = ((): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })();
  return isUsableMeta(parsed) ? parsed : null;
}

/**
 * What to tell the operator about the identity this boot is using — a CA that
 * was just minted, a certificate that was just renewed, trust that has not been
 * granted, or a CA running out of time.
 *
 * Certificate work happens silently by design, and silence is the right default
 * for a renewal the operator cannot act on. The two things they *can* act on —
 * approving a CA and replacing an expiring one — must be said out loud, and said
 * with the fingerprint, because "click through the warning" is the habit this
 * whole design exists to avoid teaching.
 *
 * @param {ServerIdentity} identity - The loaded identity.
 * @param {Date} now - The current time.
 * @returns {string[]} The lines to print, which may be none.
 */
export function identityNotice(identity: ServerIdentity, now: Date): string[] {
  const lines: string[] = [];
  if (identity.action === 'issue-ca') {
    lines.push(`issued this machine a local CA · ${identity.meta.caFingerprint}`);
  }
  if (identity.action === 'issue-leaf') {
    lines.push(`renewed this machine's server certificate · expires ${identity.meta.leafNotAfter}`);
  }
  const advice = trustAdvice(identity.meta, identity.caCertPath);
  if (advice !== null) {
    lines.push(advice);
    return lines;
  }
  if (caExpiringSoon(identity.meta, now)) {
    lines.push(
      `this machine's PAW CA expires ${identity.meta.caNotAfter} — run paw trust to replace it`,
    );
  }
  return lines;
}

/**
 * Record that this machine's CA has been installed into a trust store, which is
 * what stops the daemon warning about it on every boot.
 *
 * Called only after the install commands actually succeeded. Setting the flag on
 * intent rather than on outcome would silence the warning while the browser kept
 * refusing — the operator would be left with a broken console and nothing
 * telling them why.
 *
 * @param {IdentityPaths} paths - Where the identity lives.
 * @param {IdentityIo} io - Reading and writing it.
 * @param {boolean} trusted - The new value.
 * @returns {Promise<IdentityMeta>} The metadata as recorded.
 * @throws {Error} When there is no identity to mark.
 */
export async function markTrusted(
  paths: IdentityPaths,
  io: IdentityIo,
  trusted: boolean,
): Promise<IdentityMeta> {
  const meta = readMeta(await io.readText(paths.meta));
  if (meta === null) {
    throw new Error(`no PAW identity at ${paths.meta} — start pawd once to issue one`);
  }
  const updated: IdentityMeta = { ...meta, trusted };
  await io.writePublic(paths.meta, `${JSON.stringify(updated, null, 2)}\n`);
  return updated;
}

/**
 * Load the identity the daemon serves with, issuing whatever is missing.
 *
 * @param {IdentityPaths} paths - Where the identity lives.
 * @param {IdentityIo} io - Reading and writing it.
 * @param {IdentityIssuer} issuer - Minting certificates.
 * @param {Operator} who - Whose machine this is.
 * @param {Date} now - The current time.
 * @returns {Promise<ServerIdentity>} The certificate, key, and what had to happen.
 */
export async function loadIdentity(
  paths: IdentityPaths,
  io: IdentityIo,
  issuer: IdentityIssuer,
  who: Operator,
  now: Date,
): Promise<ServerIdentity> {
  await io.ensureDir(paths.dir);

  const [caCert, caKey, leafCert, leafKey, rawMeta] = await Promise.all([
    io.readText(paths.caCert),
    io.readText(paths.caKey),
    io.readText(paths.leafCert),
    io.readText(paths.leafKey),
    io.readText(paths.meta),
  ]);

  const files =
    caCert !== null && caKey !== null && leafCert !== null && leafKey !== null
      ? { caCert, caKey, leafCert, leafKey }
      : null;
  const meta = readMeta(rawMeta);
  const action = decideIdentity(meta, files !== null, now);

  if (files !== null && meta !== null) {
    if (action === 'reuse') {
      return {
        cert: files.leafCert,
        key: files.leafKey,
        caCert: files.caCert,
        caCertPath: paths.caCert,
        meta,
        action,
      };
    }
    if (action === 'issue-leaf') {
      const leaf = await issuer.issueLeaf(files.caCert, files.caKey, now);
      const renewed: IdentityMeta = {
        ...meta,
        leafFingerprint: leaf.fingerprint,
        leafNotAfter: leaf.notAfter,
      };
      await io.writeSecret(paths.leafKey, leaf.key);
      await io.writePublic(paths.leafCert, leaf.cert);
      await io.writePublic(paths.meta, `${JSON.stringify(renewed, null, 2)}\n`);
      return {
        cert: leaf.cert,
        key: leaf.key,
        caCert: files.caCert,
        caCertPath: paths.caCert,
        meta: renewed,
        action,
      };
    }
  }

  const ca = await issuer.issueCa(who.user, who.host, now);
  const leaf = await issuer.issueLeaf(ca.cert, ca.key, now);
  const fresh: IdentityMeta = {
    version: META_VERSION,
    caFingerprint: ca.fingerprint,
    caNotAfter: ca.notAfter,
    leafFingerprint: leaf.fingerprint,
    leafNotAfter: leaf.notAfter,
    trusted: false,
  };
  await io.writeSecret(paths.caKey, ca.key);
  await io.writePublic(paths.caCert, ca.cert);
  await io.writeSecret(paths.leafKey, leaf.key);
  await io.writePublic(paths.leafCert, leaf.cert);
  await io.writePublic(paths.meta, `${JSON.stringify(fresh, null, 2)}\n`);
  return {
    cert: leaf.cert,
    key: leaf.key,
    caCert: ca.cert,
    caCertPath: paths.caCert,
    meta: fresh,
    action: 'issue-ca',
  };
}
