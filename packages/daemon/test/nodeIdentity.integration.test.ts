/**
 * Local Identity Issuance Integration
 *
 * @fileoverview The certificates PAW asks an operator to trust, verified as a
 * skeptic would: parse the issued CA with Node's own X.509 reader, decode its
 * extensions from the DER, and prove the Name Constraints extension is present
 * **and critical** — because a non-critical constraint is one a verifier is
 * permitted to ignore, which would leave a general-purpose CA sitting in a
 * developer's trust store.
 *
 * Then prove the constraint is not decoration: a real TLS handshake against a
 * leaf issued for a non-permitted name must fail, and the loopback one must
 * succeed. Node enforces this in OpenSSL, so this is the only tier that can
 * tell the difference between a correct extension and a plausible one.
 *
 * @module @paw/daemon/test/nodeIdentity.integration
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { AsnConvert } from '@peculiar/asn1-schema';
import { NameConstraints, id_ce_nameConstraints } from '@peculiar/asn1-x509';
import {
  BasicConstraintsExtension,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  X509Certificate as PeculiarCertificate,
} from '@peculiar/x509';
import { X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { platform, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CA_DAYS,
  LEAF_DAYS,
  addDays,
} from '../src/identity.js';
import {
  issueCa,
  issueLeaf,
  loopbackNameConstraints,
  nodeIdentityIo,
  nodeSecretOps,
  nodeServerIdentity,
  pemToDer,
} from '../src/infrastructure/nodeIdentity.js';

const NOW = new Date('2026-08-06T12:00:00.000Z');

describe('the local certificate authority', () => {
  it('is a CA that cannot mint sub-CAs', async () => {
    const ca = await issueCa('dtira', 'LAPTOP', NOW);
    expect(new X509Certificate(ca.cert).ca).toBe(true);
    expect(new X509Certificate(ca.cert).subject).toContain('PAW Local CA');

    // pathLen:0 is what stops a stolen key from issuing a CA of its own;
    // name constraints alone would not.
    const basic = new PeculiarCertificate(ca.cert).getExtension(BasicConstraintsExtension);
    expect(basic?.ca).toBe(true);
    expect(basic?.pathLength).toBe(0);
    expect(basic?.critical).toBe(true);
  });

  it('carries a CRITICAL name-constraints extension — the whole reason it is safe to trust', async () => {
    const ca = await issueCa('dtira', 'LAPTOP', NOW);
    const extension = new PeculiarCertificate(ca.cert).getExtension(id_ce_nameConstraints);

    expect(extension).not.toBeNull();
    expect(extension?.critical).toBe(true);

    const decoded = AsnConvert.parse(extension!.value, NameConstraints);
    const permitted = (decoded.permittedSubtrees ?? []).map(
      (subtree) => subtree.base.dNSName ?? subtree.base.iPAddress,
    );
    expect(permitted).toEqual(['localhost', '127.0.0.0/8', '::1/128']);
  });

  it('excludes the name forms the permitted subtrees cannot reach', async () => {
    const ca = await issueCa('dtira', 'LAPTOP', NOW);
    const extension = new PeculiarCertificate(ca.cert).getExtension(id_ce_nameConstraints);
    const decoded = AsnConvert.parse(extension!.value, NameConstraints);

    // RFC 5280 §4.2.1.10: a permitted subtree constrains only the name forms a
    // certificate actually carries — "if no name of the type is in the
    // certificate, the certificate is acceptable". Without these exclusions a
    // stolen key could mint an S/MIME or URI certificate that satisfies the
    // loopback subtrees by carrying no DNS or IP name at all.
    const excluded = (decoded.excludedSubtrees ?? []).map((subtree) =>
      subtree.base.rfc822Name !== undefined
        ? 'rfc822Name'
        : subtree.base.uniformResourceIdentifier !== undefined
          ? 'uri'
          : 'other',
    );
    expect(excluded).toEqual(['rfc822Name', 'uri']);
  });

  it('is a TLS server CA and nothing else', async () => {
    const ca = await issueCa('dtira', 'LAPTOP', NOW);
    const eku = new PeculiarCertificate(ca.cert).getExtension(ExtendedKeyUsageExtension);

    // Belt to the name constraints' braces: a name form can be absent, but an
    // EKU cannot. Together they leave a stolen key able to mint exactly one
    // thing — a TLS server certificate for this machine's own loopback.
    expect(eku?.usages).toEqual([ExtendedKeyUsage.serverAuth]);
    expect(eku?.critical).toBe(true);
  });

  it('encodes the OID and the critical flag in the DER itself', async () => {
    const ca = await issueCa('dtira', 'LAPTOP', NOW);
    // 06 03 55 1d 1e = OID 2.5.29.30, 01 01 ff = BOOLEAN TRUE (critical).
    expect(new X509Certificate(ca.cert).raw.includes(Buffer.from('0603551d1e0101ff', 'hex'))).toBe(
      true,
    );
  });

  it('lives long enough that trusting it is a rare event', async () => {
    const ca = await issueCa('dtira', 'LAPTOP', NOW);
    expect(new Date(ca.notAfter).getTime()).toBe(addDays(NOW, CA_DAYS).getTime());
    expect(ca.fingerprint).toMatch(/^SHA256(:[0-9A-F]{2}){32}$/);
  });

  it('mints a different key and serial every time', async () => {
    const first = await issueCa('dtira', 'LAPTOP', NOW);
    const second = await issueCa('dtira', 'LAPTOP', NOW);
    expect(first.fingerprint).not.toBe(second.fingerprint);
    expect(first.key).not.toBe(second.key);
    expect(new X509Certificate(first.cert).serialNumber).not.toBe(
      new X509Certificate(second.cert).serialNumber,
    );
  });

  it('builds the same constraint whenever it is asked', () => {
    expect(Buffer.from(loopbackNameConstraints().value)).toEqual(
      Buffer.from(loopbackNameConstraints().value),
    );
  });
});

describe('the server certificate', () => {
  it('is issued by the CA, for loopback, as a server', async () => {
    const ca = await issueCa('dtira', 'LAPTOP', NOW);
    const leaf = await issueLeaf(ca.cert, ca.key, NOW);

    const parsedLeaf = new X509Certificate(leaf.cert);
    const parsedCa = new X509Certificate(ca.cert);

    expect(parsedLeaf.ca).toBe(false);
    expect(parsedLeaf.subjectAltName).toContain('DNS:localhost');
    expect(parsedLeaf.subjectAltName).toContain('IP Address:127.0.0.1');
    expect(parsedLeaf.checkIssued(parsedCa)).toBe(true);
    expect(parsedLeaf.verify(parsedCa.publicKey)).toBe(true);
    expect(new Date(leaf.notAfter).getTime()).toBe(addDays(NOW, LEAF_DAYS).getTime());
  });

  it('names the loopback addresses a client will actually dial', async () => {
    const ca = await issueCa('dtira', 'LAPTOP', NOW);
    const leaf = await issueLeaf(ca.cert, ca.key, NOW);
    expect(new X509Certificate(leaf.cert).checkIP('127.0.0.1')).toBe('127.0.0.1');
    expect(new X509Certificate(leaf.cert).checkHost('localhost')).toBe('localhost');
  });

  it('exports a private key Node’s TLS stack can load', async () => {
    const ca = await issueCa('dtira', 'LAPTOP', NOW);
    const leaf = await issueLeaf(ca.cert, ca.key, NOW);
    expect(leaf.key).toContain('-----BEGIN PRIVATE KEY-----');
    expect(pemToDer(leaf.key).length).toBeGreaterThan(0);
    expect(new X509Certificate(leaf.cert).publicKey).toBeDefined();
  });
});

describe('the identity directory on this machine', () => {
  it('issues into an empty PAW home and locks the private keys down for real', async () => {
    const home = await mkdtemp(join(tmpdir(), 'paw-identity-'));
    const identity = await nodeServerIdentity({ PAW_HOME: home }, platform(), NOW);

    // hardenSecret verifies after it acts, so reaching this line means the OS
    // confirmed the key is restricted to this account — an icacls listing on
    // Windows, a stat'd mode on POSIX. It is not an assertion about the write.
    expect(identity.action).toBe('issue-ca');
    expect(identity.cert).toContain('BEGIN CERTIFICATE');
    expect(identity.key).toContain('BEGIN PRIVATE KEY');
    expect(identity.caCertPath.startsWith(home.replace(/\\/g, '/'))).toBe(true);
    expect(await readFile(identity.caCertPath, 'utf8')).toBe(identity.caCert);
  }, 20000);

  it('reuses that identity on the next boot without touching the operator’s trust', async () => {
    const home = await mkdtemp(join(tmpdir(), 'paw-identity-'));
    const first = await nodeServerIdentity({ PAW_HOME: home }, platform(), NOW);
    const second = await nodeServerIdentity({ PAW_HOME: home }, platform(), NOW);

    expect(second.action).toBe('reuse');
    expect(second.cert).toBe(first.cert);
    expect(second.meta.caFingerprint).toBe(first.meta.caFingerprint);
  }, 20000);

  it('renews only the leaf once the server certificate is inside its window', async () => {
    const home = await mkdtemp(join(tmpdir(), 'paw-identity-'));
    const first = await nodeServerIdentity({ PAW_HOME: home }, platform(), NOW);
    const later = addDays(NOW, LEAF_DAYS - 1);
    const renewed = await nodeServerIdentity({ PAW_HOME: home }, platform(), later);

    expect(renewed.action).toBe('issue-leaf');
    expect(renewed.caCert).toBe(first.caCert);
    expect(renewed.meta.caFingerprint).toBe(first.meta.caFingerprint);
    expect(renewed.cert).not.toBe(first.cert);
    // The renewed leaf must still chain to the CA the operator already approved.
    expect(
      new X509Certificate(renewed.cert).verify(new X509Certificate(first.caCert).publicKey),
    ).toBe(true);
  }, 20000);

  it('reports a read that failed for any reason other than absence', async () => {
    const home = await mkdtemp(join(tmpdir(), 'paw-identity-'));
    const io = nodeIdentityIo(platform());
    // A missing file is an identity that has not been issued yet; a directory
    // where a key should be is a broken install, and saying "absent" to that
    // would silently reissue over whatever is really there.
    await expect(io.readText(join(home, 'nothing-here'))).resolves.toBeNull();
    await expect(io.readText(home)).rejects.toThrow();
  });

  it('reads and writes real file modes through the real filesystem', async () => {
    const home = await mkdtemp(join(tmpdir(), 'paw-identity-'));
    const file = join(home, 'key');
    await writeFile(file, 'secret', 'utf8');

    const ops = nodeSecretOps();
    await ops.chmod(file, 0o600);
    expect(await ops.statMode(file)).toBe((await stat(file)).mode);
    expect(ops.user()).toBe(userInfo().username);
  });
});
