/**
 * @fileoverview `paw install` — One-shot bootstrap for a fresh clone.
 *
 * Installs PAW npm dependencies, compiles the CLI bundle, and runs
 * `paw sync` to populate `.paw/` with hooks and generate `hooks.json`.
 * Idempotent: skips the install and build steps when the compiled artifact
 * already exists.
 *
 * Design note: sync is invoked as a child process rather than a direct import
 * so this command can run safely via tsx before PAW's own node_modules exist.
 * All imports here resolve through Node's parent-directory walk to the root
 * node_modules, with no dependency on `.github/PAW/node_modules`.
 *
 * @module .github/PAW/cli/commands/install
 */

import { log, spinner } from '@clack/prompts';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  buildPawCli,
  installPawDependencies,
  PAW_CLI_PATH,
} from '../../pawBootstrap';
import type { CommandMeta } from '../cliLoader';

/** Command metadata for the fs-based loader. */
export const meta: CommandMeta = {
  name: 'install',
  aliases: ['i'],
  description: 'Bootstrap PAW: install deps, build CLI, and sync hooks',
};

/**
 * Run the full PAW install pipeline.
 *
 * @param {string[]} _args - Unused; present for the CliCommand contract.
 * @returns {Promise<void>}
 */
export async function run(_args: string[]): Promise<void> {
  const s = spinner();

  if (!existsSync(PAW_CLI_PATH)) {
    s.start('Installing PAW dependencies');
    const installErr = installPawDependencies();
    if (installErr) {
      s.stop('Installation failed');
      log.error(
        'Could not install PAW dependencies. Check your Node.js version (≥18) and network connection, then re-run: npm run paw:install',
      );
      process.exit(1);
    }
    s.stop('Dependencies installed');

    s.start('Compiling PAW CLI');
    const buildErr = buildPawCli();
    if (buildErr) {
      s.stop('Build failed');
      log.error(
        'Could not compile the PAW CLI. Ensure Node.js ≥18 is installed, then re-run: npm run paw:install',
      );
      process.exit(1);
    }
    s.stop('PAW CLI compiled');
  }

  s.start('Syncing hooks into .paw/');
  const syncResult = spawnSync('node', [PAW_CLI_PATH, 'sync'], {
    stdio: 'pipe',
    timeout: 30_000,
  });
  if (syncResult.status !== 0) {
    s.stop('Sync failed');
    log.error('Hook sync failed. Re-run: npm run paw:install');
    process.exit(1);
  }
  s.stop('Hooks synced');

  log.success('PAW installed — hooks are active. Run `paw status` to verify.');
}
