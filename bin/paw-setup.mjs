#!/usr/bin/env node
/**
 * PAW installer launcher
 *
 * @fileoverview Runs the V1 installer (`packages/installer`) under tsx,
 * forwarding arguments. tsx is invoked by absolute path from the installer
 * package's own dependencies: a bare `--import tsx` resolves against the
 * caller's working directory and fails outside a repo that holds tsx.
 * `paw-setup <path|init>` until a published binary exists.
 *
 * @module @paw/bin/paw-setup
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const installerPkg = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'installer');
const tsx = join(installerPkg, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const entry = join(installerPkg, 'src', 'main.ts');
spawn(process.execPath, [tsx, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
}).on('exit', (code) => process.exit(code ?? 0));
