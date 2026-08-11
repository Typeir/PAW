/**
 * PAW Identity Store
 *
 * @fileoverview Turns identity policy into certificate daemon serve. Read disk, decide, issue what missing, persist, return leaf. Pure over {@link IdentityIo} and {@link IdentityIssuer}. Every path — first boot, leaf renewal, expired CA, half-deleted directory, sidecar from future version — unit-covered.
 *
 * Hold two invariants. Reissued CA reset `trusted` to false; flag no carry from old cert to new. Renewed leaf leave CA untouched; server cert rotate every ninety days, no trust-store change.
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
} from '../domain/identity.js';
import type { IdentityPaths } from '../domain/pawHome.js';

/**
 * Freshly issued certificate and key.
 *
 * @interface IssuedCert
 * @property {string} cert - The certificate, PEM.
 * @property {string} key - The private key, PKCS#8 PEM.
 * @property {string} fingerprint - SHA-256 of the certificate, `SHA256:AA:BB:…`.
 * @property {string} notAfter - When expire, ISO-8601.
 */
export interface IssuedCert {
  readonly cert: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly notAfter: string;
}

/**
 * Read and write identity; write secrets with owner-only permissions.
 *
 * @interface IdentityIo
 * @property {(dir: string) => Promise<void>} ensureDir - Create identity directory, restricted to this account.
 * @property {(path: string) => Promise<string | null>} readText - Read file, or null when absent.
 * @property {(path: string, text: string) => Promise<void>} writeSecret - Write private key with owner-only permissions, then verify this account can read it.
 * @property {(path: string, text: string) => Promise<void>} writePublic - Write certificate or sidecar.
 * @property {(path: string) => Promise<void>} assertPrivate - Assert existing key still readable by this account alone.
 */
export interface IdentityIo {
  ensureDir(dir: string): Promise<void>;
  readText(path: string): Promise<string | null>;
  writeSecret(path: string, text: string): Promise<void>;
  writePublic(path: string, text: string): Promise<void>;
  assertPrivate(path: string): Promise<void>;
}

/**
 * Mint certificates.
 *
 * @interface IdentityIssuer
 * @property {(user: string, host: string, now: Date) => Promise<IssuedCert>} issueCa - Mint name-constrained local CA.
 * @property {(caCert: string, caKey: string, now: Date) => Promise<IssuedCert>} issueLeaf - Mint loopback server certificate from it.
 */
export interface IdentityIssuer {
  issueCa(user: string, host: string, now: Date): Promise<IssuedCert>;
  issueLeaf(caCert: string, caKey: string, now: Date): Promise<IssuedCert>;
}

/**
 * Account and host CA issued for; supply its subject names.
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
 * Identity daemon serve with.
 *
 * @interface ServerIdentity
 * @property {string} cert - The server certificate, PEM.
 * @property {string} key - Its private key, PEM.
 * @property {string} caCert - The CA certificate, PEM — what client pin or trust.
 * @property {string} caCertPath - Where that CA sit, for trust instructions.
 * @property {IdentityMeta} meta - What now recorded about the identity.
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
 * Stored metadata, or null when none this daemon can use.
 *
 * Sidecar that no parse, or future version wrote, treated as absent, which reissue. Caller receive resulting {@link IdentityAction} and report reissue.
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
 * Build operator notice for identity this boot use — CA just minted, certificate just renewed, trust no yet granted, or CA running out time. CA-approval and expiry lines carry fingerprint; renewal operator no act on print nothing.
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
 * Record this machine's CA got installed into trust store, which stop daemon warning about it every boot.
 *
 * Called only after the install command actually succeeds. If the flag is set before the install succeeds, it suppresses the warning while the browser keeps refusing the certificate, and the operator has no error to trace.
 *
 * @param {IdentityPaths} paths - Where identity live.
 * @param {IdentityIo} io - Reading and writing it.
 * @param {boolean} trusted - The new value.
 * @returns {Promise<IdentityMeta>} The metadata as recorded.
 * @throws {Error} When no identity to mark.
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
 * Load identity daemon serve with, issue whatever missing.
 *
 * @param {IdentityPaths} paths - Where identity live.
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
      // Check this on every boot. Permissions are verified after write, but the key lives for months and can change in between — restore, copy, `chmod` from script.
      await io.assertPrivate(paths.caKey);
      await io.assertPrivate(paths.leafKey);
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
      // Verify the CA key before signing with it: this branch signs with that key, so a leaf-renewing boot must verify the key is still owner-only.
      await io.assertPrivate(paths.caKey);
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
