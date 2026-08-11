/**
 * Trust store plan tests.
 *
 * @fileoverview Checks the `paw trust` plan runs on any platform. Asserts no
 * step requires elevation and anything not automated is spelled out in the
 * manual text.
 *
 * @module @paw/daemon/test/trustStore
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { TRUST_NICKNAME, planTrust, trustCommandLine } from '../src/infrastructure/trustStore.js';

const CA = '/home/x/.local/share/paw/identity/ca.crt';
const HOME = '/home/x';

describe('planTrust', () => {
  it('installs into the per-user store on Windows, without administrator', () => {
    const plan = planTrust('win32', 'C:/paw/identity/ca.crt', 'C:/Users/x');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].command).toBe('certutil');
    expect(plan.steps[0].args).toEqual([
      '-user',
      '-addstore',
      'Root',
      'C:/paw/identity/ca.crt',
    ]);
    expect(plan.manual.length).toBeGreaterThan(0);
  });

  it('installs into the login keychain on macOS, scoped to SSL, and warns about the prompt', () => {
    const plan = planTrust('darwin', CA, HOME);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].command).toBe('security');
    // Assert exact with `toEqual`, not `toContain`. Without `-p ssl` the
    // Security.framework trust setting is unrestricted, so the CA is trusted
    // for code signing and S/MIME too. A containment assertion stays green if
    // that flag is removed.
    expect(plan.steps[0].args).toEqual([
      'add-trusted-cert',
      '-r',
      'trustRoot',
      '-p',
      'ssl',
      '-k',
      `${HOME}/Library/Keychains/login.keychain-db`,
      CA,
    ]);
    expect(plan.manual.join(' ')).toContain('password');
  });

  it('discloses on Windows that the root cannot be scoped, and how to remove it', () => {
    const manual = planTrust('win32', 'C:/paw/identity/ca.crt', 'C:/Users/x').manual.join(' ');

    // certutil has no scoping flag. The manual must state the grant is not
    // narrowed like the macOS one: it names the gap and what bounds it.
    expect(manual).toContain('no flag to scope');
    expect(manual).toContain('name constraints');
    expect(manual).toContain('-delstore Root');
  });

  it('does the NSS database on Linux and refuses to pretend about the rest', () => {
    const plan = planTrust('linux', CA, HOME);
    expect(plan.steps[0].args).toContain(`sql:${HOME}/.pki/nssdb`);
    expect(plan.steps[0].args).toContain(TRUST_NICKNAME);

    const manual = plan.manual.join('\n');
    expect(manual).toContain('update-ca-certificates');
    expect(manual).toContain('Firefox');
    expect(manual).toContain('nss-tools');
  });

  it('never asks for administrator on any platform', () => {
    for (const platform of ['win32', 'darwin', 'linux', 'freebsd']) {
      const plan = planTrust(platform, CA, HOME);
      expect(plan.steps.every((step) => !step.elevated)).toBe(true);
      expect(plan.steps.length).toBeGreaterThan(0);
    }
  });

  it('names the certificate file in every step, so nothing installs by guesswork', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      const plan = planTrust(platform, CA, HOME);
      expect(plan.steps.some((step) => step.args.includes(CA))).toBe(true);
    }
  });
});

describe('trustCommandLine', () => {
  it('prints a step as the operator could retype it', () => {
    const [step] = planTrust('win32', 'C:/paw/ca.crt', 'C:/Users/x').steps;
    expect(trustCommandLine(step)).toBe('certutil -user -addstore Root C:/paw/ca.crt');
  });

  it('quotes an argument with a space so a copied line still works', () => {
    const [step] = planTrust('linux', '/home/x/my certs/ca.crt', HOME).steps;
    expect(trustCommandLine(step)).toContain('"/home/x/my certs/ca.crt"');
    expect(trustCommandLine(step)).toContain(`"${TRUST_NICKNAME}"`);
  });
});
