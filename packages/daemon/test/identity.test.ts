/**
 * Identity policy tests.
 *
 * @fileoverview Tests identity lifecycle and when it changes, and rotation-rule boundaries. Failure modes covered: daemon fails to start when the leaf expires without renewal; needless CA reissue churns the trust store.
 *
 * @module @paw/daemon/test/identity
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import {
  CA_DAYS,
  CA_WARN_DAYS,
  LEAF_DAYS,
  LEAF_IPS,
  LEAF_RENEW_DAYS,
  LOOPBACK_DNS,
  LOOPBACK_V4_SUBTREE,
  LOOPBACK_V6_SUBTREE,
  META_VERSION,
  addDays,
  caExpiringSoon,
  caSubject,
  chromiumFingerprint,
  decideIdentity,
  formatFingerprint,
  isUsableMeta,
  trustAdvice,
  type IdentityMeta,
} from '../src/domain/identity.js';
import { identityPaths, pawHome } from '../src/domain/pawHome.js';

const NOW = new Date('2026-08-06T12:00:00.000Z');

/**
 * Metadata for an identity issued now.
 *
 * @param {Partial<IdentityMeta>} [over] - Fields to override.
 * @returns {IdentityMeta} The metadata.
 */
const meta = (over: Partial<IdentityMeta> = {}): IdentityMeta => ({
  version: META_VERSION,
  caFingerprint: 'SHA256:AA:BB',
  caNotAfter: addDays(NOW, CA_DAYS).toISOString(),
  leafFingerprint: 'SHA256:CC:DD',
  leafNotAfter: addDays(NOW, LEAF_DAYS).toISOString(),
  trusted: true,
  ...over,
});

describe('the constrained CA', () => {
  it('permits loopback names only, with the CIDR form name constraints require', () => {
    expect(LOOPBACK_DNS).toBe('localhost');
    expect(LOOPBACK_V4_SUBTREE).toBe('127.0.0.0/8');
    expect(LOOPBACK_V6_SUBTREE).toBe('::1/128');
    // Bare address here encode 4 bytes, valid in SAN and malformed inside GeneralSubtree — OpenSSL reject chain.
    expect(LOOPBACK_V4_SUBTREE).toContain('/');
    expect(LOOPBACK_V6_SUBTREE).toContain('/');
  });

  it('issues the server certificate for both loopback addresses', () => {
    expect(LEAF_IPS).toEqual(['127.0.0.1', '::1']);
  });

  it('outlives its leaves, and renews them well before they lapse', () => {
    expect(CA_DAYS).toBeGreaterThan(LEAF_DAYS);
    expect(LEAF_RENEW_DAYS).toBeLessThan(LEAF_DAYS);
    expect(CA_WARN_DAYS).toBeGreaterThan(LEAF_RENEW_DAYS);
  });

  it('names itself after the operator and machine it belongs to', () => {
    const subject = caSubject('dtira', 'LAPTOP-CKS764A6', NOW);
    expect(subject).toContain('PAW Local CA');
    expect(subject).toContain('dtira@LAPTOP-CKS764A6');
    expect(subject).toContain('2026-08');
  });
});

describe('formatFingerprint', () => {
  it('prints the digest the way a trust-store dialog will show it', () => {
    expect(formatFingerprint(new Uint8Array([0x0a, 0xbc, 0xff, 0x00]))).toBe('SHA256:0A:BC:FF:00');
  });
});

describe('chromiumFingerprint', () => {
  it('is the same digest Electron compares a peer certificate against', () => {
    const digest = new Uint8Array(32).fill(0xab);
    const formatted = formatFingerprint(digest);
    expect(chromiumFingerprint(formatted)).toBe(
      `sha256/${Buffer.from(digest).toString('base64')}`,
    );
  });

  it('round-trips a real issued fingerprint back to its bytes', () => {
    const digest = Uint8Array.from({ length: 32 }, (_, index) => index * 7);
    const encoded = chromiumFingerprint(formatFingerprint(digest));
    expect([...Buffer.from(encoded.slice('sha256/'.length), 'base64')]).toEqual([...digest]);
  });

  it('throws rather than returning a pin that could never match', () => {
    expect(() => chromiumFingerprint('SHA256:AB')).toThrow('not a formatted SHA-256');
    expect(() => chromiumFingerprint('sha256/abc')).toThrow();
    expect(() => chromiumFingerprint(formatFingerprint(new Uint8Array(31)))).toThrow();
  });
});

describe('isUsableMeta', () => {
  it('accepts what this daemon wrote', () => {
    expect(isUsableMeta(meta())).toBe(true);
  });

  it('refuses a future schema, a missing field, and junk', () => {
    expect(isUsableMeta({ ...meta(), version: META_VERSION + 1 })).toBe(false);
    expect(isUsableMeta({ ...meta(), leafNotAfter: undefined })).toBe(false);
    expect(isUsableMeta({ ...meta(), trusted: 'yes' })).toBe(false);
    expect(isUsableMeta(null)).toBe(false);
    expect(isUsableMeta('nope')).toBe(false);
  });
});

describe('decideIdentity', () => {
  it('reuses a healthy identity', () => {
    expect(decideIdentity(meta(), true, NOW)).toBe('reuse');
  });

  it('starts over when there is nothing, or the files went missing', () => {
    expect(decideIdentity(null, true, NOW)).toBe('issue-ca');
    expect(decideIdentity(meta(), false, NOW)).toBe('issue-ca');
  });

  it('starts over when the CA itself has expired', () => {
    const expired = meta({ caNotAfter: addDays(NOW, -1).toISOString() });
    expect(decideIdentity(expired, true, NOW)).toBe('issue-ca');
  });

  it('renews only the leaf when it is inside its renewal window', () => {
    const soon = meta({ leafNotAfter: addDays(NOW, LEAF_RENEW_DAYS - 1).toISOString() });
    expect(decideIdentity(soon, true, NOW)).toBe('issue-leaf');
  });

  it('renews the leaf the moment it is at the window, not a day late', () => {
    const atEdge = meta({ leafNotAfter: addDays(NOW, LEAF_RENEW_DAYS).toISOString() });
    expect(decideIdentity(atEdge, true, NOW)).toBe('issue-leaf');

    const justOutside = meta({
      leafNotAfter: new Date(addDays(NOW, LEAF_RENEW_DAYS).getTime() + 1000).toISOString(),
    });
    expect(decideIdentity(justOutside, true, NOW)).toBe('reuse');
  });

  it('renews an already-expired leaf rather than serving it', () => {
    const dead = meta({ leafNotAfter: addDays(NOW, -1).toISOString() });
    expect(decideIdentity(dead, true, NOW)).toBe('issue-leaf');
  });
});

describe('caExpiringSoon', () => {
  it('warns while there is still time to approve a replacement', () => {
    expect(caExpiringSoon(meta(), NOW)).toBe(false);
    expect(
      caExpiringSoon(meta({ caNotAfter: addDays(NOW, CA_WARN_DAYS - 1).toISOString() }), NOW),
    ).toBe(true);
  });
});

describe('trustAdvice', () => {
  it('says nothing when the CA is already trusted', () => {
    expect(trustAdvice(meta(), '/home/x/ca.crt')).toBeNull();
  });

  it('names the command, the file, and the fingerprint to compare against', () => {
    const advice = trustAdvice(meta({ trusted: false }), '/home/x/ca.crt');
    expect(advice).toContain('paw trust');
    expect(advice).toContain('/home/x/ca.crt');
    expect(advice).toContain('SHA256:AA:BB');
  });
});

describe('identityPaths', () => {
  it('keeps the identity out of any repository, under one directory', () => {
    const paths = identityPaths('/home/x/.local/share/paw');
    expect(paths.dir).toBe('/home/x/.local/share/paw/identity');
    expect(paths.caCert).toBe('/home/x/.local/share/paw/identity/ca.crt');
    expect(paths.caKey).toBe('/home/x/.local/share/paw/identity/ca.key');
    expect(paths.leafCert).toBe('/home/x/.local/share/paw/identity/leaf.crt');
    expect(paths.leafKey).toBe('/home/x/.local/share/paw/identity/leaf.key');
    expect(paths.meta).toBe('/home/x/.local/share/paw/identity/meta.json');
    expect(Object.values(paths).every((path) => !path.includes('.paw'))).toBe(true);
  });
});
