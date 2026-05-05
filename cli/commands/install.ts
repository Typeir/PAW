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
 * Uses only Node.js built-ins — no external package imports — so it runs on
 * a fresh clone with no node_modules at all.
 *
 * @module .github/PAW/cli/commands/install
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    buildPawCli,
    installPawDependencies,
    PAW_CLI_PATH,
} from '../../pawBootstrap';
import { PAW_DIR } from '../../pawPaths';
import type { CommandMeta } from '../cliLoader';

/**
 * Minimal console-based logger used during bootstrap before @clack/prompts
 * is available (i.e. before PAW's own node_modules are installed).
 */
const log = {
  /** @param {string} msg - Success message */
  success: (msg: string) => console.log(`✓ ${msg}`),
  /** @param {string} msg - Error message */
  error: (msg: string) => console.error(`✗ ${msg}`),
};

/**
 * Return a minimal spinner-like object backed by console output.
 *
 * @returns {{ start: (msg: string) => void; stop: (msg: string) => void }}
 */
function spinner(): { start: (msg: string) => void; stop: (msg: string) => void } {
  let _active = '';
  return {
    start(msg: string) {
      _active = msg;
      process.stdout.write(`  ${msg}...\n`);
    },
    stop(msg: string) {
      _active = '';
      process.stdout.write(`  ✓ ${msg}\n`);
    },
  };
}

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

  /** Bootstrap .paw/ with a default config if it doesn't exist yet.
   *  paw sync requires the directory; paw init is interactive so we can't
   *  call it here — create the minimal structure instead. */
  if (!existsSync(PAW_DIR)) {
    mkdirSync(PAW_DIR, { recursive: true });
    const defaultConfig = {
      surface: 'all',
      sourceDirectories: ['src/'],
      tasksDir: '.ignore/tasks',
      domains: [],
      gitHooks: [],
    };
    writeFileSync(
      path.join(PAW_DIR, 'config.json'),
      JSON.stringify(defaultConfig, null, 2) + '\n',
    );
  }

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

/** Auto-invoke when run directly via tsx (e.g. `npx tsx ... install.ts`).
 *  Guarded so this does NOT fire when the CLI loader imports the module. */
const isTsxEntryPoint = process.argv.some((arg) =>
  arg.replace(/\\/g, '/').endsWith('/cli/commands/install.ts'),
);
if (isTsxEntryPoint) {
  run([]).catch((err: unknown) => {
    console.error(
      '✗ Install failed:',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
}
