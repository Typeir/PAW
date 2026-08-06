/**
 * PAW Launchers
 *
 * @fileoverview Runs a V1 package's TypeScript entrypoint in this process. The
 * packages are authored in TypeScript and there is no published binary yet, so
 * every documented command would otherwise be a two-line `node …/tsx/dist/cli.mjs
 * …/src/main.ts` incantation — and `npm run` cannot carry the flags, since npm
 * claims `--port` for itself even after `--`. Registering tsx and importing the
 * entrypoint keeps it to one process, which also means the pid the daemon
 * reports is the pid you launched.
 *
 * @module @paw/bin/launch
 */

import { register } from 'tsx/esm/api';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Run a package entrypoint with tsx registered.
 *
 * @param {string} pkg - The package directory under `packages/`.
 * @returns {Promise<void>} Resolves when the entrypoint's module has evaluated.
 */
export async function launch(pkg) {
  register();
  const main = join(here, '..', 'packages', pkg, 'src', 'main.ts');
  await import(pathToFileURL(main).href);
}
