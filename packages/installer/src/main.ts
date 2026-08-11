/**
 * PAW Installer CLI (paw-setup)
 *
 * @fileoverview Installer I/O shell. Reads argv, environment, and filesystem;
 * binds adapters; delegates decisions to pure planner functions. Two commands:
 *
 *   paw-setup path [--bin=DIR] [--dry-run]   put PAW's bin dir on PATH
 *   paw-setup init [--dry-run]               attach PAW to the repo you are in
 *
 * `--dry-run` print exactly what change and write nothing — safe way to inspect
 * PATH or repo edit before consent. Excluded from unit coverage (argv, real
 * filesystem, PowerShell, `process.exit`); logic it drives tested to 100%.
 * Unknown command, or `init` outside a repo, exits non-zero. This module is
 * bundled by SEA into the native `paw-setup` executable, and install scripts call
 * it to activate PATH.
 *
 * @module @paw/installer/main
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { createNodeFs } from '@paw/adapters';
import {
  applyInit,
  binDir,
  configPathFor,
  pawHome,
  planInit,
  type InitMode,
} from '@paw/core';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activatePath, installShims } from './apply.js';
import { findRepoRoot } from './repo.js';
import { createWindowsEnv } from './adapters/windowsEnv.js';

/**
 * Default bin dir PAW install binary into.
 *
 * A single global bin root shared by the whole install, resolved by the same
 * rules as `PAW_HOME`. `~/.paw` is wrong on Windows and XDG is ignored on Linux;
 * a second location would leave half the install behind when `PAW_HOME` moves.
 *
 * Resolve on call, not at module load, so env with no home dir fail inside
 * command that need one, with that command's error, not at import time.
 *
 * @returns {string} Bin directory PAW installs into.
 * @throws {Error} When platform offer no home directory.
 */
function defaultBinDir(): string {
  return binDir(pawHome(process.platform, process.env));
}

/**
 * Read `--flag=value` option from argv.
 *
 * @param {string[]} argv - Arguments.
 * @param {string} name - Flag name (no `--` or `=`).
 * @returns {string | undefined} Value, if present.
 */
function opt(argv: string[], name: string): string | undefined {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/**
 * Run `paw-setup path`.
 *
 * @param {string[]} argv - Arguments after command.
 * @param {(s: string) => void} print - Line printer.
 */
async function runPath(argv: string[], print: (s: string) => void): Promise<void> {
  const dryRun = argv.includes('--dry-run');
  const targetBin = opt(argv, 'bin') ?? defaultBinDir();
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const verb = dryRun ? 'would' : 'did';
  const shims = await installShims(
    {
      platform: process.platform,
      binDir: targetBin,
      launchers: [
        { name: 'paw', entry: join(repoRoot, 'bin', 'paw.mjs') },
        { name: 'paw-setup', entry: join(repoRoot, 'bin', 'paw-setup.mjs') },
      ],
      dryRun,
    },
    createNodeFs(),
  );
  print(`shims: ${verb} write ${shims.map((s) => s.path.split('/').pop()).join(', ')} in ${targetBin}`);
  const edit = await activatePath(
    {
      platform: process.platform,
      shellEnv: process.env.SHELL,
      home: homedir(),
      binDir: targetBin,
      dryRun,
    },
    createNodeFs(),
    createWindowsEnv(),
  );
  if (edit.kind === 'already-present') {
    print(`PATH: ${targetBin} already active (${edit.target}).`);
  } else if (edit.kind === 'windows-registry') {
    print(`PATH: ${verb} set user Path in ${edit.target} → ${edit.newPath}`);
  } else {
    print(`PATH: ${verb} append to ${edit.target}:\n${edit.block}`);
  }
}

/**
 * Run `paw-setup init`.
 *
 * @param {string[]} argv - Arguments after command.
 * @param {(s: string) => void} print - Line printer.
 */
async function runInit(argv: string[], print: (s: string) => void): Promise<void> {
  const dryRun = argv.includes('--dry-run');
  const merge = argv.includes('--merge');
  const override = argv.includes('--override');
  if (merge && override) {
    throw new Error('paw init: --merge and --override are mutually exclusive');
  }
  const mode: InitMode = merge ? 'merge' : override ? 'override' : 'create';

  const root = findRepoRoot(process.cwd(), existsSync);
  if (root === null) {
    throw new Error('paw init: not inside a git repository');
  }

  const fs = createNodeFs();
  const existing = await fs.readText(configPathFor(root));
  const plan = dryRun
    ? planInit(root, existing === '' ? null : existing, mode)
    : await applyInit(root, fs, mode);

  const verb = dryRun ? 'would write' : 'wrote';
  for (const write of plan.writes) {
    print(`init: ${verb} ${write.path}`);
  }
  if (plan.refusal !== undefined) {
    throw new Error(`paw init: ${plan.refusal.reason}`);
  }
}

/**
 * Installer entrypoint.
 */
async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);
  const print = (s: string): void => {
    process.stdout.write(`${s}\n`);
  };
  if (command === 'path') {
    await runPath(argv, print);
    return;
  }
  if (command === 'init') {
    await runInit(argv, print);
    return;
  }
  throw new Error(`usage: paw-setup <path|init> [--dry-run] [--bin=DIR]`);
}

main().catch((err: unknown) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
