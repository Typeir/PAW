/**
 * PAW local identity issuance.
 *
 * @fileoverview Effects behind {@link identity}: generate keys, sign name-
 * constrained CA and its server cert, write em to machine's PAW home, lock
 * private keys to owner. Every constant it use — permitted subtrees, validity
 * windows, rotation rule — come from pure policy module.
 *
 * Assemble Name Constraints extension by hand cause `@peculiar/x509` ship no
 * class for it: value ASN.1 `NameConstraints` structure serialised with
 * `@peculiar/asn1-schema`, wrapped in library's generic `Extension`, marked
 * **critical** so any conforming verifier must honour it or reject chain.
 * Inside `GeneralSubtree` encode IP as address-plus-mask, so subtrees carry
 * CIDR prefixes; SAN entries carry addresses.
 *
 * Write private keys then **verify** owner-only. On a shared machine, a
 * readable key lets another user sign as the operator.
 *
 * This the only file in package whose types come from `lib.dom` not
 * `@types/node`: WebCrypto's `CryptoKey`, `EcKeyGenParams` and friends declared
 * there, and `@peculiar/x509`'s public API written against em. Every tsconfig
 * that compiles this package's sources therefore list `DOM`.
 *
 * @module @paw/daemon/nodeIdentity
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { AsnConvert } from '@peculiar/asn1-schema';
import {
  GeneralName as AsnGeneralName,
  GeneralSubtree,
  GeneralSubtrees,
  NameConstraints,
  id_ce_nameConstraints,
} from '@peculiar/asn1-x509';
import {
  AuthorityKeyIdentifierExtension,
  BasicConstraintsExtension,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  Extension,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  SubjectKeyIdentifierExtension,
  X509Certificate,
  X509CertificateGenerator,
  cryptoProvider,
} from '@peculiar/x509';
import { execFile } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import { promisify } from 'node:util';
import {
  CA_DAYS,
  LEAF_DAYS,
  LEAF_IPS,
  LOOPBACK_DNS,
  LOOPBACK_V4_SUBTREE,
  LOOPBACK_V6_SUBTREE,
  addDays,
  caSubject,
  formatFingerprint,
} from '../domain/identity.js';
import {
  loadIdentity,
  type IdentityIo,
  type IdentityIssuer,
  type ServerIdentity,
} from './identityStore.js';
import { identityPaths, pawHome, type HomeEnv } from '../domain/pawHome.js';
import {
  SECRET_DIR_MODE,
  SECRET_MODE,
  assertPrivate,
  hardenSecret,
  hardenSecretDir,
  type SecretOps,
} from './secretFile.js';

cryptoProvider.set(webcrypto as unknown as Crypto);

/**
 * Key algorithm. P-256 universally supported by browsers and Node's TLS
 * stack, small enough issuance imperceptible.
 */
const ALGORITHM: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };

/**
 * Signature algorithm; hash specified here, on the signing params.
 */
const SIGNING: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' } as EcdsaParams;

/**
 * Certificate and the private key belong to it, as PEM.
 *
 * @interface KeyPairPem
 * @property {string} cert - Certificate, PEM.
 * @property {string} key - Private key, PKCS8 PEM.
 * @property {string} fingerprint - SHA-256 of certificate, formatted for operator.
 * @property {string} notAfter - When expire, ISO-8601.
 */
export interface KeyPairPem {
  readonly cert: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly notAfter: string;
}

/**
 * Wrap exported PKCS8 key as PEM. `@peculiar/x509` serialise certificates
 * only; private-key encoding handled here.
 *
 * @param {ArrayBuffer} der - Exported key.
 * @returns {string} PEM document.
 */
function pkcs8Pem(der: ArrayBuffer): string {
  const body = Buffer.from(der)
    .toString('base64')
    .replace(/(.{64})/g, '$1\n')
    .replace(/\n$/, '');
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
}

/**
 * Fingerprint of certificate, as operator see it.
 *
 * @param {X509Certificate} cert - Certificate.
 * @returns {Promise<string>} Formatted digest.
 */
async function fingerprintOf(cert: X509Certificate): Promise<string> {
  return formatFingerprint(new Uint8Array(await cert.getThumbprint('SHA-256')));
}

/**
 * Critical Name Constraints extension: permits loopback names only, so a
 * stolen key cannot forge identity for any site on the internet.
 *
 * @returns {Extension} Extension.
 */
export function loopbackNameConstraints(): Extension {
  const value = AsnConvert.serialize(
    new NameConstraints({
      permittedSubtrees: new GeneralSubtrees([
        new GeneralSubtree({ base: new AsnGeneralName({ dNSName: LOOPBACK_DNS }) }),
        new GeneralSubtree({ base: new AsnGeneralName({ iPAddress: LOOPBACK_V4_SUBTREE }) }),
        new GeneralSubtree({ base: new AsnGeneralName({ iPAddress: LOOPBACK_V6_SUBTREE }) }),
      ]),
      // Permitted subtrees alone not enough, per RFC 5280 §4.2.1.10: subtree
      // constrain only name forms actually *present* in certificate — "if no
      // name of the type in the certificate, the certificate acceptable".
      // A leaf carrying only an email address, URI, or directory name would
      // satisfy the DNS and IP subtrees above by having none of them, so a
      // stolen CA key could mint an S/MIME or code-signing certificate that
      // escapes the constraint. Excluding those forms with an empty base
      // matches every name of that type, closing that gap.
      excludedSubtrees: new GeneralSubtrees([
        new GeneralSubtree({ base: new AsnGeneralName({ rfc822Name: '' }) }),
        new GeneralSubtree({ base: new AsnGeneralName({ uniformResourceIdentifier: '' }) }),
      ]),
    }),
  );
  return new Extension(id_ce_nameConstraints, true, value);
}

/**
 * Issue local certificate authority.
 *
 * @param {string} user - Operator's username, for subject.
 * @param {string} host - Machine's hostname, for subject.
 * @param {Date} now - Issuing time.
 * @returns {Promise<KeyPairPem>} CA cert and key.
 */
export async function issueCa(user: string, host: string, now: Date): Promise<KeyPairPem> {
  const keys = (await webcrypto.subtle.generateKey(ALGORITHM, true, [
    'sign',
    'verify',
  ])) as unknown as CryptoKeyPair;
  const notAfter = addDays(now, CA_DAYS);
  const cert = await X509CertificateGenerator.createSelfSigned({
    serialNumber: randomSerial(),
    name: caSubject(user, host, now),
    notBefore: now,
    notAfter,
    signingAlgorithm: SIGNING,
    keys,
    extensions: [
      new BasicConstraintsExtension(true, 0, true),
      new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
      loopbackNameConstraints(),
      // Name constraints bind only name forms a certificate actually carries:
      // per RFC 5280 a subtree is satisfied when no name of that type is
      // present. A certificate with no SAN at all — a code-signing or S/MIME
      // certificate — would be *unconstrained* by the subtrees above. This EKU
      // restricts every certificate under this CA to TLS server auth.
      new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth], true),
      await SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  return {
    cert: cert.toString('pem'),
    key: pkcs8Pem(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)),
    fingerprint: await fingerprintOf(cert),
    notAfter: notAfter.toISOString(),
  };
}

/**
 * Issue server certificate from CA, valid for loopback only.
 *
 * @param {string} caCertPem - CA certificate.
 * @param {string} caKeyPem - CA private key.
 * @param {Date} now - Issuing time.
 * @returns {Promise<KeyPairPem>} Server certificate and key.
 */
export async function issueLeaf(
  caCertPem: string,
  caKeyPem: string,
  now: Date,
): Promise<KeyPairPem> {
  const ca = new X509Certificate(caCertPem);
  const caKey = (await webcrypto.subtle.importKey(
    'pkcs8',
    pemToDer(caKeyPem),
    ALGORITHM,
    false,
    ['sign'],
  )) as unknown as CryptoKey;
  const keys = (await webcrypto.subtle.generateKey(ALGORITHM, true, [
    'sign',
    'verify',
  ])) as unknown as CryptoKeyPair;
  const notAfter = addDays(now, LEAF_DAYS);

  const cert = await X509CertificateGenerator.create({
    serialNumber: randomSerial(),
    subject: `CN=${LOOPBACK_DNS}`,
    issuer: ca.subject,
    notBefore: now,
    notAfter,
    signingAlgorithm: SIGNING,
    publicKey: keys.publicKey,
    signingKey: caKey,
    extensions: [
      new BasicConstraintsExtension(false, undefined, true),
      new KeyUsagesExtension(
        KeyUsageFlags.digitalSignature | KeyUsageFlags.keyEncipherment,
        true,
      ),
      new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth], false),
      new SubjectAlternativeNameExtension([
        { type: 'dns', value: LOOPBACK_DNS },
        ...LEAF_IPS.map((value) => ({ type: 'ip' as const, value })),
      ]),
      await SubjectKeyIdentifierExtension.create(keys.publicKey),
      await AuthorityKeyIdentifierExtension.create(ca.publicKey),
    ],
  });

  return {
    cert: cert.toString('pem'),
    key: pkcs8Pem(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)),
    fingerprint: await fingerprintOf(cert),
    notAfter: notAfter.toISOString(),
  };
}

/**
 * Random 64-bit positive serial number, as hex string generator want.
 *
 * @returns {string} Serial.
 */
function randomSerial(): string {
  const bytes = webcrypto.getRandomValues(new Uint8Array(8));
  bytes[0] &= 0x7f;
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Decode PEM document's base64 body.
 *
 * @param {string} pem - PEM document.
 * @returns {Uint8Array} DER bytes over a dedicated `ArrayBuffer`, never Node's
 * shared pool — WebCrypto take `BufferSource`, and pooled `Buffer` typed over
 * `ArrayBufferLike`, which may be shared memory.
 */
export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const raw = Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
  const der = new Uint8Array(new ArrayBuffer(raw.length));
  der.set(raw);
  return der;
}

/**
 * Run program, return stdout, no shell — arguments carry `(OI)(CI)` and path
 * that may hold spaces, and shell one quoting mistake away from execute part
 * of filename.
 */
const run = promisify(execFile);

/**
 * System permission effects.
 *
 * @returns {SecretOps} Ops, over this process's account.
 */
export function nodeSecretOps(): SecretOps {
  return {
    chmod: (path: string, mode: number) => chmod(path, mode),
    statMode: async (path: string) => (await stat(path)).mode,
    run: async (command: string, args: readonly string[]) =>
      (await run(command, [...args], { windowsHide: true })).stdout,
    user: () => userInfo().username,
  };
}

/**
 * Node identity directory: create private, read what is there, write private
 * keys, then enforce permissions via hardenSecret and hardenSecretDir.
 *
 * @param {string} platform - Platform, as `os.platform()` report it.
 * @returns {IdentityIo} Io.
 */
export function nodeIdentityIo(platform: string): IdentityIo {
  const ops = nodeSecretOps();
  return {
    ensureDir: async (dir: string): Promise<void> => {
      await mkdir(dir, { recursive: true, mode: SECRET_DIR_MODE });
      await hardenSecretDir(dir, platform, ops);
    },

    readText: async (path: string): Promise<string | null> => {
      try {
        return await readFile(path, 'utf8');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
        return null;
      }
    },

    writeSecret: async (path: string, text: string): Promise<void> => {
      await writeFile(path, text, { encoding: 'utf8', mode: SECRET_MODE });
      await hardenSecret(path, platform, ops);
    },

    writePublic: (path: string, text: string): Promise<void> => writeFile(path, text, 'utf8'),

    assertPrivate: (path: string): Promise<void> => assertPrivate(path, platform, ops),
  };
}

/**
 * Issuer backed by WebCrypto certificate generation.
 */
export const nodeIssuer: IdentityIssuer = { issueCa, issueLeaf };

/**
 * Load — issue on first run, renew when due — identity this machine serve TLS
 * with.
 *
 * @param {HomeEnv} env - Environment, for locating PAW's home.
 * @param {string} platform - Platform.
 * @param {Date} now - Current time.
 * @returns {Promise<ServerIdentity>} Certificate, its key, and what had to happen.
 */
export function nodeServerIdentity(
  env: HomeEnv,
  platform: string,
  now: Date,
): Promise<ServerIdentity> {
  return loadIdentity(
    identityPaths(pawHome(platform, env)),
    nodeIdentityIo(platform),
    nodeIssuer,
    { user: userInfo().username, host: hostname() },
    now,
  );
}
