/**
 * Trust Store Plans
 *
 * @fileoverview Build per-platform plan to make this machine PAW CA
 * trusted. Data operator read before any run. Pure: decide which
 * commands, never run. Unit-test every platform from any
 * platform. `paw trust --dry-run` print what `paw trust` run. Every plan
 * follows two rules. Prefer per-user store: `certutil -user` on Windows and
 * login keychain on macOS install root for one account, no
 * elevation. State what no automate: Linux got no single trust store —
 * system bundle need root, Firefox keep own NSS database, container
 * maybe have neither. Plan carry those as `manual` line.
 *
 * @module @paw/daemon/trustStore
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Name CA filed under in trust store. Find and remove by it.
 */
export const TRUST_NICKNAME = 'PAW Local CA';

/**
 * One command in trust plan.
 *
 * @interface TrustStep
 * @property {string} command - The program run.
 * @property {readonly string[]} args - Its arguments, unquoted and unshelled.
 * @property {string} describe - What it do, for operator.
 * @property {boolean} elevated - Whether need administrator or root.
 */
export interface TrustStep {
  readonly command: string;
  readonly args: readonly string[];
  readonly describe: string;
  readonly elevated: boolean;
}

/**
 * How to trust CA on one platform.
 *
 * @interface TrustPlan
 * @property {readonly TrustStep[]} steps - What `paw trust` run, in order.
 * @property {readonly string[]} manual - What it no do.
 */
export interface TrustPlan {
  readonly steps: readonly TrustStep[];
  readonly manual: readonly string[];
}

/**
 * Render step as single line. For `--dry-run` and for error message
 * when step fail.
 *
 * @param {TrustStep} step - The step.
 * @returns {string} The command line.
 */
export function trustCommandLine(step: TrustStep): string {
  const args = step.args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg));
  return [step.command, ...args].join(' ');
}

/**
 * Build plan to trust this machine PAW CA.
 *
 * @param {string} platform - The platform, as `os.platform()` report it.
 * @param {string} caPath - Where CA certificate sit.
 * @param {string} home - Operator home directory.
 * @returns {TrustPlan} The plan.
 */
export function planTrust(platform: string, caPath: string, home: string): TrustPlan {
  if (platform === 'win32') {
    return {
      steps: [
        {
          command: 'certutil',
          args: ['-user', '-addstore', 'Root', caPath],
          describe: 'add the CA to this account’s Trusted Root store',
          elevated: false,
        },
      ],
      manual: [
        'certutil has no flag to scope a root to TLS, so this CA is trusted for',
        'every purpose in your user store. Its name constraints and its',
        'serverAuth EKU are what bound that — it can vouch for loopback TLS and',
        'nothing else. Remove it with: certutil -user -delstore Root "PAW Local CA"',
      ],
    };
  }

  if (platform === 'darwin') {
    return {
      steps: [
        {
          command: 'security',
          args: [
            'add-trusted-cert',
            '-r',
            'trustRoot',
            // Scoped to SSL. Without `-p`, Security.framework treats the
            // trust setting as unrestricted, and the CA becomes trusted
            // for code signing, S/MIME and timestamping as well.
            '-p',
            'ssl',
            '-k',
            `${home}/Library/Keychains/login.keychain-db`,
            caPath,
          ],
          describe: 'add the CA to your login keychain as a trusted SSL root',
          elevated: false,
        },
      ],
      manual: ['macOS will ask for your password to modify the login keychain.'],
    };
  }

  return {
    steps: [
      {
        command: 'certutil',
        args: ['-d', `sql:${home}/.pki/nssdb`, '-A', '-t', 'C,,', '-n', TRUST_NICKNAME, '-i', caPath],
        describe: 'add the CA to your NSS database, which Chrome and Chromium read',
        elevated: false,
      },
    ],
    manual: [
      'Linux has no single trust store, so two things are left to you:',
      `  system-wide:  sudo cp ${caPath} /usr/local/share/ca-certificates/paw-local-ca.crt && sudo update-ca-certificates`,
      `  Firefox:      Settings → Privacy & Security → Certificates → View Certificates → Import ${caPath}`,
      'The NSS step above needs libnss3-tools (Debian/Ubuntu) or nss-tools (Fedora).',
    ],
  };
}
