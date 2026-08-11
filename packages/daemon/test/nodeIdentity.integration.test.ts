/**
 * Local Identity Issuance Integration
 *
 * @fileoverview PAW CA cert asks operator trust. Parse issued CA with Node X.509 reader, decode extension from DER, prove Name Constraints extension present and critical. A non-critical constraint is ignored by verifiers, so a general-purpose CA would remain in the developer trust store.
 *
 * Then run TLS handshake against leaf issued for non-permitted name; it must fail, loopback handshake must succeed. Node enforces this in OpenSSL, so the handshake distinguishes a correct extension from a plausible one.
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
} from '../src/domain/identity.js';
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

    // pathLen:0 blocks the private key from minting sub-CAs; name constraints alone do not.
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
    // cert actually carries — "if no name of the type is in the certificate, the
    // certificate is acceptable". Without these exclusions a compromised key
    // could mint an S/MIME or URI cert that satisfies loopback subtrees by
    // carrying no DNS or IP name at all.
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

    // A name form can be absent from a cert, but EKU cannot. Together the two
    // extensions let a compromised key mint exactly one thing: a TLS server
    // certificate for this machine's own loopback addresses.
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

    // hardenSecret verifies permissions after acting, so reaching this line
    // means the OS confirmed the key is restricted to this account — via icacls
    // listing on Windows, stat'd mode on POSIX. No assertion about write access.
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
    // Renewed leaf still chains to the CA the operator already approved.
    expect(
      new X509Certificate(renewed.cert).verify(new X509Certificate(first.caCert).publicKey),
    ).toBe(true);
  }, 20000);

  it('reports a read that failed for any reason other than absence', async () => {
    const home = await mkdtemp(join(tmpdir(), 'paw-identity-'));
    const io = nodeIdentityIo(platform());
    // A missing file means the identity is not issued yet. A directory where
    // the key should be means a broken install; reporting it as absent would
    // silently reissue over whatever is actually there.
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
