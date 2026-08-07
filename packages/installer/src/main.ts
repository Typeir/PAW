/**
 * PAW Installer CLI (paw-setup)
 *
 * @fileoverview The installer's I/O shell: it gathers the real environment and
 * binds the real adapters, then delegates every decision to the pure planners and
 * the application layer. Two commands:
 *
 *   paw-setup path [--bin=DIR] [--dry-run]   put PAW's bin dir on PATH
 *   paw-setup init [--dry-run]               attach PAW to the repo you are in
 *
 * `--dry-run` prints exactly what would change and writes nothing — the safe way
 * to inspect a PATH or repo edit before consenting to it. Excluded from unit
 * coverage (argv, real filesystem, PowerShell, `process.exit`); the logic it
 * drives is tested to 100%. Fails loud: an unknown command, or `init` outside a
 * repo, exits non-zero. This entry is what the SEA build packages into a native
 * `paw-setup` executable, and what the install scripts call to activate PATH.
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
import { activatePath } from './apply.js';
import { findRepoRoot } from './repo.js';
import { createWindowsEnv } from './adapters/windowsEnv.js';

/**
 * The default bin directory PAW installs its binary into.
 *
 * One global root for the whole install: the same `PAW_HOME` the TLS identity
 * already lives under, resolved by the same rules. `~/.paw` would be wrong on
 * Windows and would ignore XDG on Linux, and a second location would mean an
 * operator moving `PAW_HOME` moved half their installation.
 *
 * Resolved on call rather than at module load so an environment that offers no
 * home directory fails inside the command that needed one, with that command's
 * error, instead of at import time.
 *
 * @returns {string} The bin directory PAW installs into.
 * @throws {Error} When the platform offers no home directory.
 */
function defaultBinDir(): string {
  return binDir(pawHome(process.platform, process.env));
}

/**
 * Read a `--flag=value` option from argv.
 *
 * @param {string[]} argv - The arguments.
 * @param {string} name - The flag name (without `--` or `=`).
 * @returns {string | undefined} The value, if present.
 */
function opt(argv: string[], name: string): string | undefined {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/**
 * Run `paw-setup path`.
 *
 * @param {string[]} argv - Arguments after the command.
 * @param {(s: string) => void} print - Line printer.
 */
async function runPath(argv: string[], print: (s: string) => void): Promise<void> {
  const dryRun = argv.includes('--dry-run');
  const targetBin = opt(argv, 'bin') ?? defaultBinDir();
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
  const verb = dryRun ? 'would' : 'did';
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
 * @param {string[]} argv - Arguments after the command.
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
