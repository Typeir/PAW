/**
 * Identity Store Tests
 *
 * @fileoverview Every state the identity directory can be found in, including
 * the ones that only occur months later or after someone has been editing files
 * by hand. The two assertions worth naming: a reissued CA must come back
 * untrusted, and a renewed leaf must not touch the CA — get either wrong and the
 * operator is either warned about nothing or asked to re-approve every ninety
 * days until they stop reading the warning.
 *
 * @module @paw/daemon/test/identityStore
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  CA_DAYS,
  LEAF_DAYS,
  LEAF_RENEW_DAYS,
  META_VERSION,
  addDays,
  type IdentityMeta,
} from '../src/identity.js';
import {
  identityNotice,
  loadIdentity,
  markTrusted,
  readMeta,
  type IdentityIssuer,
  type IdentityIo,
  type ServerIdentity,
} from '../src/identityStore.js';
import { identityPaths } from '../src/pawHome.js';

const NOW = new Date('2026-08-06T12:00:00.000Z');
const PATHS = identityPaths('/home/x/.local/share/paw');
const WHO = { user: 'dtira', host: 'LAPTOP' };

/**
 * Metadata describing an identity issued today.
 *
 * @param {Partial<IdentityMeta>} [over] - Fields to override.
 * @returns {IdentityMeta} The metadata.
 */
const meta = (over: Partial<IdentityMeta> = {}): IdentityMeta => ({
  version: META_VERSION,
  caFingerprint: 'SHA256:CA:OLD',
  caNotAfter: addDays(NOW, CA_DAYS).toISOString(),
  leafFingerprint: 'SHA256:LEAF:OLD',
  leafNotAfter: addDays(NOW, LEAF_DAYS).toISOString(),
  trusted: true,
  ...over,
});

/**
 * A fake identity directory holding the given files.
 *
 * @param {Record<string, string>} files - Path to contents.
 * @returns {IdentityIo & { written: Record<string, string>; secrets: string[]; dirs: string[] }} The io and what it recorded.
 */
const fakeIo = (
  files: Record<string, string> = {},
): IdentityIo & { written: Record<string, string>; secrets: string[]; dirs: string[] } => {
  const written: Record<string, string> = {};
  const secrets: string[] = [];
  const dirs: string[] = [];
  return {
    written,
    secrets,
    dirs,
    ensureDir: async (dir) => {
      dirs.push(dir);
    },
    readText: async (path) => files[path] ?? null,
    writeSecret: async (path, text) => {
      secrets.push(path);
      written[path] = text;
    },
    writePublic: async (path, text) => {
      written[path] = text;
    },
  };
};

/**
 * An issuer that mints recognisable certificates without any crypto.
 *
 * @returns {IdentityIssuer} The fake issuer.
 */
const fakeIssuer = (): IdentityIssuer => ({
  issueCa: vi.fn(async (user: string, host: string) => ({
    cert: `CA-CERT(${user}@${host})`,
    key: 'CA-KEY',
    fingerprint: 'SHA256:CA:NEW',
    notAfter: addDays(NOW, CA_DAYS).toISOString(),
  })),
  issueLeaf: vi.fn(async (caCert: string) => ({
    cert: `LEAF-CERT(from ${caCert})`,
    key: 'LEAF-KEY',
    fingerprint: 'SHA256:LEAF:NEW',
    notAfter: addDays(NOW, LEAF_DAYS).toISOString(),
  })),
});

/**
 * An identity directory in a healthy state.
 *
 * @param {IdentityMeta} [stored] - The sidecar to store.
 * @returns {Record<string, string>} The files.
 */
const healthy = (stored: IdentityMeta = meta()): Record<string, string> => ({
  [PATHS.caCert]: 'CA-CERT(stored)',
  [PATHS.caKey]: 'CA-KEY(stored)',
  [PATHS.leafCert]: 'LEAF-CERT(stored)',
  [PATHS.leafKey]: 'LEAF-KEY(stored)',
  [PATHS.meta]: JSON.stringify(stored),
});

/**
 * A loaded identity, for the notice tests.
 *
 * @param {Partial<ServerIdentity>} [over] - Fields to override.
 * @returns {ServerIdentity} The identity.
 */
const loaded = (over: Partial<ServerIdentity> = {}): ServerIdentity => ({
  cert: 'LEAF',
  key: 'KEY',
  caCert: 'CA',
  caCertPath: PATHS.caCert,
  action: 'reuse',
  meta: meta(),
  ...over,
});

describe('identityNotice', () => {
  it('says nothing when a trusted identity is simply reused', () => {
    expect(identityNotice(loaded(), NOW)).toEqual([]);
  });

  it('announces a new CA with the fingerprint the OS dialog will show', () => {
    const lines = identityNotice(
      loaded({ action: 'issue-ca', meta: meta({ trusted: false }) }),
      NOW,
    );
    expect(lines[0]).toContain('issued this machine a local CA');
    expect(lines[0]).toContain('SHA256:CA:OLD');
    expect(lines[1]).toContain('paw trust');
    expect(lines[1]).toContain(PATHS.caCert);
  });

  it('mentions a renewal without asking for anything, because nothing is asked', () => {
    const lines = identityNotice(loaded({ action: 'issue-leaf' }), NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('renewed');
    expect(lines[0]).not.toContain('paw trust');
  });

  it('warns while a trusted CA still has time to be replaced', () => {
    const expiring = meta({ caNotAfter: addDays(NOW, 10).toISOString() });
    const lines = identityNotice(loaded({ meta: expiring }), NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('expires');
    expect(lines[0]).toContain('paw trust');
  });

  it('asks for trust rather than warning twice when the CA is both untrusted and expiring', () => {
    const expiring = meta({ trusted: false, caNotAfter: addDays(NOW, 10).toISOString() });
    const lines = identityNotice(loaded({ meta: expiring }), NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('not yet trusted');
  });
});

describe('readMeta', () => {
  it('reads back what the daemon wrote', () => {
    expect(readMeta(JSON.stringify(meta()))).toEqual(meta());
  });

  it('treats an absent, unparseable, or unrecognised sidecar as no identity', () => {
    expect(readMeta(null)).toBeNull();
    expect(readMeta('{ not json')).toBeNull();
    expect(readMeta('null')).toBeNull();
    expect(readMeta(JSON.stringify({ ...meta(), version: META_VERSION + 1 }))).toBeNull();
  });
});

describe('markTrusted', () => {
  it('records the operator’s approval where the next boot will read it', async () => {
    const io = fakeIo(healthy(meta({ trusted: false })));
    const updated = await markTrusted(PATHS, io, true);

    expect(updated.trusted).toBe(true);
    expect(JSON.parse(io.written[PATHS.meta]).trusted).toBe(true);
    expect(io.secrets).toEqual([]);
  });

  it('leaves every other field exactly as it was', async () => {
    const io = fakeIo(healthy(meta({ trusted: false })));
    const updated = await markTrusted(PATHS, io, true);
    expect(updated.caFingerprint).toBe('SHA256:CA:OLD');
    expect(updated.leafNotAfter).toBe(meta().leafNotAfter);
  });

  it('can withdraw approval too, for a CA that was removed by hand', async () => {
    const io = fakeIo(healthy());
    expect((await markTrusted(PATHS, io, false)).trusted).toBe(false);
  });

  it('refuses when there is no identity to mark, rather than writing one', async () => {
    const io = fakeIo();
    await expect(markTrusted(PATHS, io, true)).rejects.toThrow('no PAW identity at');
    expect(io.written).toEqual({});
  });
});

describe('loadIdentity on a machine that has none', () => {
  it('mints a CA for this operator, a leaf from it, and records both', async () => {
    const io = fakeIo();
    const issuer = fakeIssuer();
    const identity = await loadIdentity(PATHS, io, issuer, WHO, NOW);

    expect(identity.action).toBe('issue-ca');
    expect(issuer.issueCa).toHaveBeenCalledWith('dtira', 'LAPTOP', NOW);
    expect(identity.caCert).toBe('CA-CERT(dtira@LAPTOP)');
    expect(identity.cert).toBe('LEAF-CERT(from CA-CERT(dtira@LAPTOP))');
    expect(identity.caCertPath).toBe(PATHS.caCert);
    expect(io.dirs).toEqual([PATHS.dir]);
  });

  it('writes the two private keys as secrets and nothing else as one', async () => {
    const io = fakeIo();
    await loadIdentity(PATHS, io, fakeIssuer(), WHO, NOW);
    expect(io.secrets).toEqual([PATHS.caKey, PATHS.leafKey]);
    expect(Object.keys(io.written).sort()).toEqual(
      [PATHS.caCert, PATHS.caKey, PATHS.leafCert, PATHS.leafKey, PATHS.meta].sort(),
    );
  });

  it('records the new CA as UNTRUSTED, because nobody has approved it yet', async () => {
    const io = fakeIo();
    const identity = await loadIdentity(PATHS, io, fakeIssuer(), WHO, NOW);
    expect(identity.meta.trusted).toBe(false);
    expect(JSON.parse(io.written[PATHS.meta])).toEqual({
      version: META_VERSION,
      caFingerprint: 'SHA256:CA:NEW',
      caNotAfter: addDays(NOW, CA_DAYS).toISOString(),
      leafFingerprint: 'SHA256:LEAF:NEW',
      leafNotAfter: addDays(NOW, LEAF_DAYS).toISOString(),
      trusted: false,
    });
  });
});

describe('loadIdentity on a healthy machine', () => {
  it('serves what is already there and mints nothing', async () => {
    const io = fakeIo(healthy());
    const issuer = fakeIssuer();
    const identity = await loadIdentity(PATHS, io, issuer, WHO, NOW);

    expect(identity.action).toBe('reuse');
    expect(identity.cert).toBe('LEAF-CERT(stored)');
    expect(identity.key).toBe('LEAF-KEY(stored)');
    expect(identity.caCert).toBe('CA-CERT(stored)');
    expect(identity.meta.trusted).toBe(true);
    expect(issuer.issueCa).not.toHaveBeenCalled();
    expect(issuer.issueLeaf).not.toHaveBeenCalled();
    expect(io.written).toEqual({});
  });
});

describe('loadIdentity when the server certificate is running out', () => {
  it('renews the leaf from the CA the operator already trusts', async () => {
    const expiring = meta({ leafNotAfter: addDays(NOW, LEAF_RENEW_DAYS - 1).toISOString() });
    const io = fakeIo(healthy(expiring));
    const issuer = fakeIssuer();
    const identity = await loadIdentity(PATHS, io, issuer, WHO, NOW);

    expect(identity.action).toBe('issue-leaf');
    expect(issuer.issueCa).not.toHaveBeenCalled();
    expect(issuer.issueLeaf).toHaveBeenCalledWith('CA-CERT(stored)', 'CA-KEY(stored)', NOW);
    expect(identity.cert).toBe('LEAF-CERT(from CA-CERT(stored))');
    expect(identity.caCert).toBe('CA-CERT(stored)');
  });

  it('leaves the CA files and the operator’s approval alone', async () => {
    const expiring = meta({ leafNotAfter: addDays(NOW, -1).toISOString() });
    const io = fakeIo(healthy(expiring));
    const identity = await loadIdentity(PATHS, io, fakeIssuer(), WHO, NOW);

    expect(Object.keys(io.written).sort()).toEqual(
      [PATHS.leafCert, PATHS.leafKey, PATHS.meta].sort(),
    );
    expect(io.secrets).toEqual([PATHS.leafKey]);
    expect(identity.meta.trusted).toBe(true);
    expect(identity.meta.caFingerprint).toBe('SHA256:CA:OLD');
    expect(identity.meta.leafFingerprint).toBe('SHA256:LEAF:NEW');
  });
});

describe('loadIdentity when the directory has been disturbed', () => {
  it('starts over when a key was deleted but its certificate was not', async () => {
    const files = healthy();
    delete files[PATHS.caKey];
    const identity = await loadIdentity(PATHS, fakeIo(files), fakeIssuer(), WHO, NOW);
    expect(identity.action).toBe('issue-ca');
  });

  it('starts over when the sidecar is unreadable, rather than trusting stale files', async () => {
    const io = fakeIo({ ...healthy(), [PATHS.meta]: 'corrupted{' });
    const identity = await loadIdentity(PATHS, io, fakeIssuer(), WHO, NOW);
    expect(identity.action).toBe('issue-ca');
    expect(identity.meta.trusted).toBe(false);
  });

  it('starts over when the CA has expired, and the new one needs approving again', async () => {
    const io = fakeIo(healthy(meta({ caNotAfter: addDays(NOW, -1).toISOString() })));
    const identity = await loadIdentity(PATHS, io, fakeIssuer(), WHO, NOW);
    expect(identity.action).toBe('issue-ca');
    expect(identity.meta.caFingerprint).toBe('SHA256:CA:NEW');
    expect(identity.meta.trusted).toBe(false);
    expect(io.secrets).toEqual([PATHS.caKey, PATHS.leafKey]);
  });
});
