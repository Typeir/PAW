#!/usr/bin/env node
/**
 * PAW CLI launcher
 *
 * @fileoverview Runs the V1 CLI (`packages/cli`) under tsx, forwarding
 * arguments. tsx is invoked by absolute path from the cli package's own
 * dependencies: a bare `--import tsx` resolves against the caller's working
 * directory, so `paw` run from a repository without tsx in its node_modules
 * chain fails with ERR_MODULE_NOT_FOUND. `paw <command>` until a published
 * binary exists.
 *
 * @module @paw/bin/paw
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliPkg = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'cli');
const tsx = join(cliPkg, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const entry = join(cliPkg, 'src', 'infrastructure', 'main.ts');
spawn(process.execPath, [tsx, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
}).on('exit', (code) => process.exit(code ?? 0));
