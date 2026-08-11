#!/usr/bin/env node
/**
 * PAW CLI launcher
 *
 * @fileoverview Runs the V1 CLI (`packages/cli`) under tsx, forwarding arguments.
 * `paw <command>` until a published binary exists.
 *
 * @module @paw/bin/paw
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'cli',
  'src',
  'infrastructure',
  'main.ts',
);
spawn(process.execPath, ['--import', 'tsx', entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
}).on('exit', (code) => process.exit(code ?? 0));
