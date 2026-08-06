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

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { activatePath, applyInit } from './apply.js';
import { findRepoRoot } from './repo.js';
import { planInit } from './scaffold.js';
import { createNodeFs } from './adapters/nodeFs.js';
import { createWindowsEnv } from './adapters/windowsEnv.js';

/**
 * The default bin directory PAW installs its binary into.
 */
const DEFAULT_BIN = join(homedir(), '.paw', 'bin');

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
  const binDir = opt(argv, 'bin') ?? DEFAULT_BIN;
  const edit = await activatePath(
    { platform: process.platform, shellEnv: process.env.SHELL, home: homedir(), binDir, dryRun },
    createNodeFs(),
    createWindowsEnv(),
  );
  const verb = dryRun ? 'would' : 'did';
  if (edit.kind === 'already-present') {
    print(`PATH: ${binDir} already active (${edit.target}).`);
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
  const root = findRepoRoot(process.cwd(), existsSync);
  if (root === null) {
    throw new Error('paw init: not inside a git repository');
  }
  if (dryRun) {
    for (const write of planInit(root).writes) {
      print(`init: would write ${write.path}`);
    }
    return;
  }
  const plan = await applyInit(root, createNodeFs());
  for (const write of plan.writes) {
    print(`init: wrote ${write.path}`);
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
