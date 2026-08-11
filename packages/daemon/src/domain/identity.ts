/**
 * PAW local identity policy.
 *
 * @fileoverview What PAW's local certificate authority may be, and when it must
 * be replaced. `nodeIdentity` make key, write file, read every
 * constant from here.
 *
 * CA carry critical X.509 Name Constraints extension, loopback names only —
 * `localhost`, `127.0.0.0/8`, `::1/128`. Steal private key, forge cert only for
 * victim's own loopback interface. `pathLen: 0` stop mint sub-CA; name
 * constraints alone no stop that.
 *
 * CA sign short-lived leaf, so rotate server cert never make operator touch
 * trust store again.
 *
 * @module @paw/daemon/identity
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Names leaf cert valid for, only names CA may sign for. In Name Constraints
 * extension IP must carry CIDR prefix — RFC 5280 encode subtree as address plus
 * mask — so these exact strings issuer pass through.
 */
export const LOOPBACK_DNS = 'localhost';

/**
 * IPv4 loopback subtree CA may sign for.
 */
export const LOOPBACK_V4_SUBTREE = '127.0.0.0/8';

/**
 * IPv6 loopback subtree CA may sign for.
 */
export const LOOPBACK_V6_SUBTREE = '::1/128';

/**
 * Addresses server cert itself carry, as SAN entries.
 */
export const LEAF_IPS: readonly string[] = ['127.0.0.1', '::1'];

/**
 * How long fresh CA stay good. Long, cause replace mean ask operator approve
 * trust-store change again.
 */
export const CA_DAYS = 3650;

/**
 * How long server cert stay good.
 */
export const LEAF_DAYS = 90;

/**
 * How much life must stay on leaf before reissue. Daemon start in this window,
 * quietly get new cert from CA operator already trust.
 */
export const LEAF_RENEW_DAYS = 30;

/**
 * How much life must stay on CA before warn operator. Replace need consent,
 * so warning must come early enough to act on.
 */
export const CA_WARN_DAYS = 90;

/**
 * Schema version of metadata sidecar, so future format change detected, no
 * misread.
 */
export const META_VERSION = 1;

/**
 * Day, in milliseconds.
 */
const DAY_MS = 86_400_000;

/**
 * Metadata daemon stores for identity it issued.
 *
 * @interface IdentityMeta
 * @property {number} version - Sidecar schema version.
 * @property {string} caFingerprint - SHA-256 of CA cert, colon-separated hex.
 * @property {string} caNotAfter - When CA expire, ISO-8601.
 * @property {string} leafFingerprint - SHA-256 of server cert.
 * @property {string} leafNotAfter - When server cert expire, ISO-8601.
 * @property {boolean} trusted - Whether installer report CA into trust store.
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
 * What daemon must do before serve TLS.
 *
 * @typedef {'issue-ca' | 'issue-leaf' | 'reuse'} IdentityAction
 */
export type IdentityAction = 'issue-ca' | 'issue-leaf' | 'reuse';

/**
 * Subject name of PAW local CA, say whose machine it belong to, so operator
 * recognize it in trust store years later.
 *
 * @param {string} user - Operator's username.
 * @param {string} host - Machine's hostname.
 * @param {Date} now - Issuing date.
 * @returns {string} Distinguished name.
 */
export function caSubject(user: string, host: string, now: Date): string {
  const month = now.toISOString().slice(0, 7);
  return `CN=PAW Local CA (${user}@${host}, ${month}), O=PAW`;
}

/**
 * Add days to date.
 *
 * @param {Date} from - Starting point.
 * @param {number} days - How many days to add.
 * @returns {Date} Later date.
 */
export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/**
 * Format cert digest the way operator see it in trust-store dialog, so
 * fingerprint PAW print compare by eye against one OS show.
 *
 * @param {Uint8Array} digest - Raw SHA-256 digest.
 * @returns {string} `SHA256:AA:BB:…`.
 */
export function formatFingerprint(digest: Uint8Array): string {
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase());
  return `SHA256:${hex.join(':')}`;
}

/**
 * Same digest in form Chromium report peer cert, so desktop shell pin exact
 * cert its daemon load from disk.
 *
 * Pinning compare hash of presented cert against exact digest; CA trust
 * validate presented cert against CA-signed chain. Bad digest throw. Pin
 * always fail mean shell cannot connect; pin always match mean no pinning.
 *
 * @param {string} fingerprint - Digest as {@link formatFingerprint} write it.
 * @returns {string} `sha256/<base64>` form Electron compare against.
 * @throws {Error} When digest no formatted SHA-256.
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
 * Whether stored metadata one daemon can read.
 *
 * @param {unknown} value - Parsed sidecar.
 * @returns {value is IdentityMeta} True when usable.
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
 * What daemon must do to have usable identity right now.
 *
 * Missing or unreadable CA mean start over. CA present but leaf missing, expired,
 * or in renewal window mean new leaf — cost operator nothing, cause CA they
 * trust still sign it.
 *
 * @param {IdentityMeta | null} meta - Stored metadata, or null when absent or unreadable.
 * @param {boolean} filesPresent - Whether every identity file exist on disk.
 * @param {Date} now - Current time.
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
 * Whether CA close enough to expiry that tell operator now, while still time
 * to approve replacement.
 *
 * @param {IdentityMeta} meta - Stored metadata.
 * @param {Date} now - Current time.
 * @returns {boolean} True when operator should be warned.
 */
export function caExpiringSoon(meta: IdentityMeta, now: Date): boolean {
  return new Date(meta.caNotAfter).getTime() <= addDays(now, CA_WARN_DAYS).getTime();
}

/**
 * What to tell operator about trusting CA, or null when nothing to say.
 * Daemon serve TLS regardless of CA trust. Untrusted CA make browser warning;
 * operator handle it. Daemon does not fall back to plaintext.
 *
 * @param {IdentityMeta} meta - Stored metadata.
 * @param {string} caPath - Where CA cert sit.
 * @returns {string | null} Advice, or null when CA already trusted.
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
