/**
 * Trust Store Plan Tests
 *
 * @fileoverview What `paw trust` will run, checked per platform from any
 * platform. The assertions that matter are not "does it call certutil" but the
 * two properties the plans exist to hold: nothing asks for elevation, and
 * anything that cannot be automated is stated instead of skipped.
 *
 * @module @paw/daemon/test/trustStore
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { TRUST_NICKNAME, planTrust, trustCommandLine } from '../src/trustStore.js';

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
    expect(plan.manual).toEqual([]);
  });

  it('installs into the login keychain on macOS, and warns about the password prompt', () => {
    const plan = planTrust('darwin', CA, HOME);
    expect(plan.steps[0].command).toBe('security');
    expect(plan.steps[0].args).toContain('trustRoot');
    expect(plan.steps[0].args).toContain(`${HOME}/Library/Keychains/login.keychain-db`);
    expect(plan.manual.join(' ')).toContain('password');
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
