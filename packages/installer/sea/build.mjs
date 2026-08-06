/**
 * PAW Installer SEA Build
 *
 * @fileoverview Packages the installer CLI into a real native executable using
 * Node's Single Executable Applications feature (stable enough on Node 22, which
 * this repo pins). It bundles `src/main.ts` to one CommonJS file with esbuild
 * (rewriting the `.js` specifiers `@paw/core` uses to their `.ts` sources, as the
 * gui/daemon builds do), generates the SEA blob, copies the running `node` binary,
 * and injects the blob with `postject`. The result — `dist/paw-setup(.exe)` — runs
 * with no Node install. The same pipeline packages the top-level `paw` CLI once
 * `paw-setup`'s `path`/`init` are folded into that router; point ENTRY at it.
 *
 * @module @paw/installer/sea/build
 */

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject } from 'postject';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');
const dist = join(pkg, 'dist');
const ENTRY = join(pkg, 'src', 'main.ts');
const isWin = process.platform === 'win32';
const exe = join(dist, isWin ? 'paw-setup.exe' : 'paw-setup');
const bundle = join(dist, 'paw-setup.cjs');
const blob = join(dist, 'sea-prep.blob');
const seaConfig = join(dist, 'sea-config.json');
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

/** Rewrite relative `*.js` specifiers to the co-located `*.ts` source. */
const tsResolve = {
  name: 'ts-resolve',
  setup(b) {
    b.onResolve({ filter: /\.js$/ }, (args) => {
      if (args.kind === 'entry-point' || !args.path.startsWith('.')) return undefined;
      const cand = join(args.resolveDir, args.path.replace(/\.js$/, '.ts'));
      return existsSync(cand) ? { path: cand } : undefined;
    });
  },
};

await build({
  entryPoints: [ENTRY],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  plugins: [tsResolve],
});

await writeFile(
  seaConfig,
  JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true }, null, 2),
);

execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });
await copyFile(process.execPath, exe);
await inject(exe, 'NODE_SEA_BLOB', await readFile(blob), { sentinelFuse: FUSE, overwrite: true });

process.stdout.write(`built ${exe}\n`);
