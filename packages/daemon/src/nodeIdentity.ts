/**
 * PAW Local Identity Issuance
 *
 * @fileoverview The effects behind {@link identity}: generating keys, signing a
 * name-constrained CA and its server certificate, writing them to the machine's
 * PAW home, and locking the private keys down to their owner. Every constant it
 * uses — the permitted subtrees, the validity windows, the rotation rule — comes
 * from the pure policy module; this file is the hands, not the head.
 *
 * The Name Constraints extension is assembled by hand because
 * `@peculiar/x509` ships no class for it: the value is an ASN.1 `NameConstraints`
 * structure serialised with `@peculiar/asn1-schema` and wrapped in the library's
 * generic `Extension`, marked **critical** so any conforming verifier must honour
 * it or reject the chain. Inside a `GeneralSubtree` an IP is encoded as
 * address-plus-mask, which is why the subtrees carry CIDR prefixes and the SAN
 * entries do not.
 *
 * Private keys are written and then **verified** to be owner-only. A key that
 * cannot be locked down is not a key this daemon will serve with, because on a
 * shared machine a readable key is another user's licence to impersonate the
 * operator's console.
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
  Extension,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
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
} from './identity.js';
import {
  loadIdentity,
  type IdentityIo,
  type IdentityIssuer,
  type ServerIdentity,
} from './identityStore.js';
import { identityPaths, pawHome, type HomeEnv } from './pawHome.js';
import {
  SECRET_DIR_MODE,
  SECRET_MODE,
  hardenSecret,
  hardenSecretDir,
  type SecretOps,
} from './secretFile.js';

cryptoProvider.set(webcrypto as unknown as Crypto);

/**
 * The key algorithm. P-256 is universally supported by browsers and by Node's
 * TLS stack, and is small enough that issuance is imperceptible.
 */
const ALGORITHM: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };

/**
 * The signature algorithm; the hash lives here, not on the key parameters.
 */
const SIGNING: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' } as EcdsaParams;

/**
 * A certificate and the private key that belongs to it, as PEM.
 *
 * @interface KeyPairPem
 * @property {string} cert - The certificate, PEM.
 * @property {string} key - The private key, PKCS8 PEM.
 * @property {string} fingerprint - SHA-256 of the certificate, formatted for an operator.
 * @property {string} notAfter - When it expires, ISO-8601.
 */
export interface KeyPairPem {
  readonly cert: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly notAfter: string;
}

/**
 * Wrap an exported PKCS8 key as PEM. `@peculiar/x509` serialises certificates
 * but not private keys, so this is the one piece of encoding done by hand.
 *
 * @param {ArrayBuffer} der - The exported key.
 * @returns {string} The PEM document.
 */
function pkcs8Pem(der: ArrayBuffer): string {
  const body = Buffer.from(der)
    .toString('base64')
    .replace(/(.{64})/g, '$1\n')
    .replace(/\n$/, '');
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
}

/**
 * The fingerprint of a certificate, as an operator will see it.
 *
 * @param {X509Certificate} cert - The certificate.
 * @returns {Promise<string>} The formatted digest.
 */
async function fingerprintOf(cert: X509Certificate): Promise<string> {
  return formatFingerprint(new Uint8Array(await cert.getThumbprint('SHA-256')));
}

/**
 * The critical Name Constraints extension that makes this CA safe to trust: it
 * may vouch for loopback and nothing else, so a stolen key cannot forge an
 * identity for any site on the internet.
 *
 * @returns {Extension} The extension.
 */
export function loopbackNameConstraints(): Extension {
  const value = AsnConvert.serialize(
    new NameConstraints({
      permittedSubtrees: new GeneralSubtrees([
        new GeneralSubtree({ base: new AsnGeneralName({ dNSName: LOOPBACK_DNS }) }),
        new GeneralSubtree({ base: new AsnGeneralName({ iPAddress: LOOPBACK_V4_SUBTREE }) }),
        new GeneralSubtree({ base: new AsnGeneralName({ iPAddress: LOOPBACK_V6_SUBTREE }) }),
      ]),
    }),
  );
  return new Extension(id_ce_nameConstraints, true, value);
}

/**
 * Issue the local certificate authority.
 *
 * @param {string} user - The operator's username, for the subject.
 * @param {string} host - The machine's hostname, for the subject.
 * @param {Date} now - The issuing time.
 * @returns {Promise<KeyPairPem>} The CA certificate and key.
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
 * Issue a server certificate from the CA, valid for loopback only.
 *
 * @param {string} caCertPem - The CA certificate.
 * @param {string} caKeyPem - The CA private key.
 * @param {Date} now - The issuing time.
 * @returns {Promise<KeyPairPem>} The server certificate and key.
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
 * A random 64-bit positive serial number, as the hex string the generator wants.
 *
 * @returns {string} The serial.
 */
function randomSerial(): string {
  const bytes = webcrypto.getRandomValues(new Uint8Array(8));
  bytes[0] &= 0x7f;
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Decode a PEM document's base64 body.
 *
 * @param {string} pem - The PEM document.
 * @returns {Uint8Array} The DER bytes, over their own `ArrayBuffer` rather than
 * Node's shared pool — WebCrypto takes a `BufferSource`, and a pooled `Buffer`
 * is typed over `ArrayBufferLike`, which may be shared memory.
 */
export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const raw = Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
  const der = new Uint8Array(new ArrayBuffer(raw.length));
  der.set(raw);
  return der;
}

/**
 * Run a program and return its stdout, without a shell — the arguments carry
 * `(OI)(CI)` and a path that may hold spaces, and a shell would be one quoting
 * mistake away from executing part of a filename.
 */
const run = promisify(execFile);

/**
 * The real permission effects.
 *
 * @returns {SecretOps} The ops, over this process's account.
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
 * The real identity directory: create it private, read what is there, and write
 * private keys with their permissions proven rather than assumed.
 *
 * @param {string} platform - The platform, as `os.platform()` reports it.
 * @returns {IdentityIo} The io.
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
  };
}

/**
 * The real issuer.
 */
export const nodeIssuer: IdentityIssuer = { issueCa, issueLeaf };

/**
 * Load — issuing on first run, renewing when due — the identity this machine
 * serves TLS with.
 *
 * @param {HomeEnv} env - The environment, for locating PAW's home.
 * @param {string} platform - The platform.
 * @param {Date} now - The current time.
 * @returns {Promise<ServerIdentity>} The certificate, its key, and what had to happen.
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
