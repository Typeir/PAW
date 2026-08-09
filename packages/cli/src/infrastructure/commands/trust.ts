/**
 * PAW CLI — trust command
 *
 * @fileoverview `paw trust [--dry-run]`: install this machine's PAW CA into a
 * trust store so the console loads without a browser warning. The operator must
 * see the whole thing before consenting — `--dry-run` prints the exact commands
 * and the fingerprint, and the identity is marked trusted only once every step
 * actually succeeded, never on intent.
 *
 * @module @paw/cli/infrastructure/commands/trust
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import {
  identityPaths,
  markTrusted,
  nodeIdentityIo,
  nodeServerIdentity,
  pawHome,
  planTrust,
  trustCommandLine,
} from '@paw/daemon';

/**
 * Run a program to completion, capturing what it said.
 *
 * @param {string} command - The program.
 * @param {readonly string[]} args - Its arguments.
 * @returns {Promise<{ code: number; output: string }>} The exit code and combined output.
 */
function runCommand(
  command: string,
  args: readonly string[],
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(command, [...args], { windowsHide: true }, (err, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim();
      if (err === null) {
        resolve({ code: 0, output });
        return;
      }
      const code = typeof err.code === 'number' ? err.code : 1;
      resolve({ code: code === 0 ? 1 : code, output: output === '' ? err.message : output });
    });
  });
}

/**
 * Install this machine's PAW CA into a trust store, so the console loads without
 * a browser warning.
 *
 * @param {string[]} rest - The words after `trust`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} The exit code.
 */
export async function runTrust(rest: string[], print: (lines: string[]) => void): Promise<number> {
  const dryRun = rest.includes('--dry-run');
  const platform = process.platform;
  const identity = await nodeServerIdentity(process.env, platform, new Date());
  const plan = planTrust(platform, identity.caCertPath, homedir());

  print([
    `PAW local CA · ${identity.meta.caFingerprint}`,
    `  certificate: ${identity.caCertPath}`,
    '  the OS dialog must show that exact fingerprint — refuse it if it does not',
    '',
    ...plan.steps.map((step) => `  ${step.describe}\n    ${trustCommandLine(step)}`),
    ...(plan.manual.length === 0 ? [] : ['', ...plan.manual]),
  ]);

  if (dryRun) {
    print(['', 'dry run · nothing was changed']);
    return 0;
  }
  if (identity.meta.trusted) {
    print(['', 'already recorded as trusted · re-running the steps above anyway']);
  }

  for (const step of plan.steps) {
    const result = await runCommand(step.command, step.args);
    if (result.code !== 0) {
      process.stderr.write(
        `trust failed: ${trustCommandLine(step)}\n` +
          `  exit ${result.code}\n${result.output.replace(/^/gm, '  ')}\n`,
      );
      return 1;
    }
  }

  await markTrusted(
    identityPaths(pawHome(platform, process.env)),
    nodeIdentityIo(platform),
    true,
  );
  print(['', 'trusted · restart the browser tab for it to take effect']);
  return 0;
}
