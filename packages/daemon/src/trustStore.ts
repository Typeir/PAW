/**
 * Trust Store Plans
 *
 * @fileoverview What it takes to make this machine's PAW CA trusted, per
 * platform, as a plan the operator can read before any of it runs. Pure: this
 * file decides *which* commands, never runs them, so the decision is unit-tested
 * on every platform from any platform and `paw trust --dry-run` prints exactly
 * what `paw trust` would do.
 *
 * Two rules shape every plan here.
 *
 * **Prefer the per-user store.** `certutil -user` on Windows and the login
 * keychain on macOS both install a root for one account without elevation.
 * Asking for administrator to install a CA is asking for a habit nobody should
 * have, and a machine-wide root is a larger blast radius than the problem needs.
 *
 * **Say what cannot be automated.** Linux has no single trust store — the system
 * bundle needs root, Firefox keeps its own NSS database, and a container may have
 * neither. The plan carries those as `manual` lines rather than pretending, so
 * the operator is never told a job is done that was not done.
 *
 * @module @paw/daemon/trustStore
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * The name the CA is filed under in a trust store, so an operator can find and
 * remove it later without guessing.
 */
export const TRUST_NICKNAME = 'PAW Local CA';

/**
 * One command in a trust plan.
 *
 * @interface TrustStep
 * @property {string} command - The program to run.
 * @property {readonly string[]} args - Its arguments, unquoted and unshelled.
 * @property {string} describe - What it does, for the operator.
 * @property {boolean} elevated - Whether it needs administrator or root.
 */
export interface TrustStep {
  readonly command: string;
  readonly args: readonly string[];
  readonly describe: string;
  readonly elevated: boolean;
}

/**
 * How to trust the CA on one platform.
 *
 * @interface TrustPlan
 * @property {readonly TrustStep[]} steps - What `paw trust` will run, in order.
 * @property {readonly string[]} manual - What it cannot do, stated plainly.
 */
export interface TrustPlan {
  readonly steps: readonly TrustStep[];
  readonly manual: readonly string[];
}

/**
 * A step as a single readable line, for `--dry-run` and for the error message
 * when a step fails — an operator who is told which command failed can run it
 * themselves, and one who is told "trust failed" cannot.
 *
 * @param {TrustStep} step - The step.
 * @returns {string} The command line.
 */
export function trustCommandLine(step: TrustStep): string {
  const args = step.args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg));
  return [step.command, ...args].join(' ');
}

/**
 * How to trust this machine's PAW CA.
 *
 * @param {string} platform - The platform, as `os.platform()` reports it.
 * @param {string} caPath - Where the CA certificate sits.
 * @param {string} home - The operator's home directory.
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
      manual: [],
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
            '-k',
            `${home}/Library/Keychains/login.keychain-db`,
            caPath,
          ],
          describe: 'add the CA to your login keychain as a trusted root',
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
