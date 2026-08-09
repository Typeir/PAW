#!/usr/bin/env node
/**
 * PAW installer launcher
 *
 * @fileoverview Runs the V1 installer (`packages/installer`) under tsx, forwarding
 * arguments. `paw-setup <path|init>` until a published binary exists.
 *
 * @module @paw/bin/paw-setup
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'installer',
  'src',
  'main.ts',
);
spawn(process.execPath, ['--import', 'tsx', entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
}).on('exit', (code) => process.exit(code ?? 0));
