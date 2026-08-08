/**
 * PAW Local Identity Policy
 *
 * @fileoverview What PAW's local certificate authority is allowed to be, and
 * when it must be replaced. Pure decisions only — issuing keys and writing files
 * happens in `nodeIdentity`, which reads its every constant from here.
 *
 * The design point worth defending: PAW asks an operator to trust a CA in their
 * OS store, and a CA that could mint a certificate for `mail.google.com` would
 * be an unforgivable thing to leave on a developer's machine. So the CA carries
 * a **critical X.509 Name Constraints extension permitting loopback names only**
 * — `localhost`, `127.0.0.0/8`, `::1/128`. If its private key is stolen, the
 * strongest thing the thief can forge is a certificate for the victim's own
 * loopback interface. `pathLen: 0` stops it minting sub-CAs, which name
 * constraints alone would not.
 *
 * The CA signs a short-lived leaf rather than being trusted directly, so
 * rotating the server certificate never asks the operator to touch their trust
 * store again.
 *
 * @module @paw/daemon/identity
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * The names the leaf certificate is valid for, and the only names the CA is
 * permitted to sign for. Inside a Name Constraints extension an IP **must**
 * carry a CIDR prefix — RFC 5280 encodes the subtree as address plus mask — so
 * these are the exact strings the issuer passes through.
 */
export const LOOPBACK_DNS = 'localhost';

/**
 * The IPv4 loopback subtree the CA may sign for.
 */
export const LOOPBACK_V4_SUBTREE = '127.0.0.0/8';

/**
 * The IPv6 loopback subtree the CA may sign for.
 */
export const LOOPBACK_V6_SUBTREE = '::1/128';

/**
 * The addresses the server certificate itself carries, as SAN entries.
 */
export const LEAF_IPS: readonly string[] = ['127.0.0.1', '::1'];

/**
 * How long a freshly issued CA is good for. Long, because replacing it means
 * asking the operator to approve a trust-store change again.
 */
export const CA_DAYS = 3650;

/**
 * How long a server certificate is good for.
 */
export const LEAF_DAYS = 90;

/**
 * How much life must remain on the leaf before it is reissued. A daemon that
 * starts inside this window quietly gets a new certificate from the CA the
 * operator already trusts.
 */
export const LEAF_RENEW_DAYS = 30;

/**
 * How much life must remain on the CA before the operator is warned. Replacing
 * it needs their consent, so the warning has to come early enough to act on.
 */
export const CA_WARN_DAYS = 90;

/**
 * The schema version of the metadata sidecar, so a future format change is
 * detected rather than misread.
 */
export const META_VERSION = 1;

/**
 * A day, in milliseconds.
 */
const DAY_MS = 86_400_000;

/**
 * What the daemon remembers about the identity it issued.
 *
 * @interface IdentityMeta
 * @property {number} version - The sidecar schema version.
 * @property {string} caFingerprint - SHA-256 of the CA certificate, colon-separated hex.
 * @property {string} caNotAfter - When the CA expires, ISO-8601.
 * @property {string} leafFingerprint - SHA-256 of the server certificate.
 * @property {string} leafNotAfter - When the server certificate expires, ISO-8601.
 * @property {boolean} trusted - Whether an installer reported the CA into a trust store.
 */
export interface IdentityMeta {
  readonly version: number;
  readonly caFingerprint: string;
  readonly caNotAfter: string;
  readonly leafFingerprint: string;
  readonly leafNotAfter: string;
  readonly trusted: boolean;
}

/**
 * What the daemon must do before it can serve TLS.
 *
 * @typedef {'issue-ca' | 'issue-leaf' | 'reuse'} IdentityAction
 */
export type IdentityAction = 'issue-ca' | 'issue-leaf' | 'reuse';

/**
 * The subject name of a PAW local CA, identifying whose machine it belongs to
 * so an operator can recognise it in a trust store years later.
 *
 * @param {string} user - The operator's username.
 * @param {string} host - The machine's hostname.
 * @param {Date} now - The issuing date.
 * @returns {string} The distinguished name.
 */
export function caSubject(user: string, host: string, now: Date): string {
  const month = now.toISOString().slice(0, 7);
  return `CN=PAW Local CA (${user}@${host}, ${month}), O=PAW`;
}

/**
 * Add days to a date.
 *
 * @param {Date} from - The starting point.
 * @param {number} days - How many days to add.
 * @returns {Date} The later date.
 */
export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/**
 * Format a certificate digest the way an operator will see it in a trust-store
 * dialog, so the fingerprint PAW prints can be compared by eye against the one
 * the OS shows.
 *
 * @param {Uint8Array} digest - The raw SHA-256 digest.
 * @returns {string} `SHA256:AA:BB:…`.
 */
export function formatFingerprint(digest: Uint8Array): string {
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase());
  return `SHA256:${hex.join(':')}`;
}

/**
 * The same digest in the form Chromium reports a peer certificate in, so a
 * desktop shell can pin the exact certificate its own daemon just loaded from
 * disk rather than trusting a CA and hoping.
 *
 * Pinning is the stronger claim: CA trust says "someone this machine trusts
 * vouched for this name", pinning says "this is the certificate my daemon is
 * holding". A malformed digest throws rather than producing a value that would
 * silently never match — a pin that always fails is a shell that cannot connect,
 * and a pin that always matches would be no pin at all.
 *
 * @param {string} fingerprint - The digest as {@link formatFingerprint} writes it.
 * @returns {string} The `sha256/<base64>` form Electron compares against.
 * @throws {Error} When the digest is not a formatted SHA-256.
 */
export function chromiumFingerprint(fingerprint: string): string {
  if (!/^SHA256(:[0-9A-F]{2}){32}$/.test(fingerprint)) {
    throw new Error(`not a formatted SHA-256 fingerprint: ${fingerprint}`);
  }
  const bytes = fingerprint
    .slice('SHA256:'.length)
    .split(':')
    .map((byte) => Number.parseInt(byte, 16));
  return `sha256/${Buffer.from(bytes).toString('base64')}`;
}

/**
 * Whether stored metadata is one this daemon can read.
 *
 * @param {unknown} value - The parsed sidecar.
 * @returns {value is IdentityMeta} True when it is usable.
 */
export function isUsableMeta(value: unknown): value is IdentityMeta {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const meta = value as Partial<IdentityMeta>;
  return (
    meta.version === META_VERSION &&
    typeof meta.caFingerprint === 'string' &&
    typeof meta.caNotAfter === 'string' &&
    typeof meta.leafFingerprint === 'string' &&
    typeof meta.leafNotAfter === 'string' &&
    typeof meta.trusted === 'boolean'
  );
}

/**
 * What the daemon must do to have a usable identity right now.
 *
 * A missing or unreadable CA means starting over. A CA that is present but
 * whose leaf is missing, expired, or inside its renewal window means a new leaf
 * — which costs the operator nothing, because the CA they trusted still signs
 * it.
 *
 * @param {IdentityMeta | null} meta - The stored metadata, or null when absent or unreadable.
 * @param {boolean} filesPresent - Whether every identity file exists on disk.
 * @param {Date} now - The current time.
 * @returns {IdentityAction} What to do.
 */
export function decideIdentity(
  meta: IdentityMeta | null,
  filesPresent: boolean,
  now: Date,
): IdentityAction {
  if (meta === null || !filesPresent) {
    return 'issue-ca';
  }
  if (new Date(meta.caNotAfter).getTime() <= now.getTime()) {
    return 'issue-ca';
  }
  if (new Date(meta.leafNotAfter).getTime() <= addDays(now, LEAF_RENEW_DAYS).getTime()) {
    return 'issue-leaf';
  }
  return 'reuse';
}

/**
 * Whether the CA is close enough to expiry that the operator should be told
 * now, while there is still time to approve its replacement.
 *
 * @param {IdentityMeta} meta - The stored metadata.
 * @param {Date} now - The current time.
 * @returns {boolean} True when the operator should be warned.
 */
export function caExpiringSoon(meta: IdentityMeta, now: Date): boolean {
  return new Date(meta.caNotAfter).getTime() <= addDays(now, CA_WARN_DAYS).getTime();
}

/**
 * What to tell the operator about trusting the CA, or null when there is
 * nothing to say. Serving continues either way — an untrusted CA produces a
 * browser warning, which is the operator's decision to make, not something the
 * daemon may paper over by falling back to plaintext.
 *
 * @param {IdentityMeta} meta - The stored metadata.
 * @param {string} caPath - Where the CA certificate sits.
 * @returns {string | null} The advice, or null when the CA is already trusted.
 */
export function trustAdvice(meta: IdentityMeta, caPath: string): string | null {
  if (meta.trusted) {
    return null;
  }
  return [
    `This machine's PAW CA is not yet trusted, so the browser will warn.`,
    `  run:         paw trust`,
    `  certificate: ${caPath}`,
    `  fingerprint: ${meta.caFingerprint}`,
    `  (the OS dialog must show that exact fingerprint)`,
  ].join('\n');
}
