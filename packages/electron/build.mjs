/**
 * PAW Electron Build
 *
 * @fileoverview Compiles the two TypeScript entry points of the desktop shell to
 * the CommonJS that Electron's main process and its sandboxed preload require.
 * Electron cannot run this monorepo's `.ts` sources directly, and a sandboxed
 * preload cannot be an ES module, so esbuild is the build step here exactly as it
 * is for `@paw/gui`. `electron` and Node built-ins are left external, and both
 * outputs carry the `.cjs` extension because this package is `"type": "module"`.
 *
 * @module @paw/electron/build
 */

import { build } from 'esbuild';
import { cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  logLevel: 'info',
};

// `@paw/daemon` is ESM and reads `import.meta.url` to locate files relative to
// itself. Bundled to CommonJS that expression has no meaning, so it is bound to
// the CommonJS equivalent declared in the banner — without this the main bundle
// throws on module init. It applies to the MAIN process only: a sandboxed
// preload may require nothing but `electron`, so a `require("node:url")` banner
// there kills the preload — and with it the window bridge the console's titlebar
// needs — without any error reaching the terminal.
const mainProcessOnly = {
  define: { 'import.meta.url': '__pawModuleUrl' },
  banner: {
    js: 'const __pawModuleUrl = require("node:url").pathToFileURL(__filename).href;',
  },
};

await build({
  ...common,
  ...mainProcessOnly,
  entryPoints: [join(here, 'src', 'main.ts')],
  outfile: join(here, 'dist', 'main.cjs'),
});

await build({
  ...common,
  entryPoints: [join(here, 'src', 'preload.ts')],
  outfile: join(here, 'dist', 'preload.cjs'),
});

// `ps-list` shells out to a small `fastlist` binary it locates beside its own
// module. Bundled, "its own module" is `dist/main.cjs`, so the binaries are
// copied to `dist/vendor` — without them the daemon cannot read the host process
// table and refuses to start.
const psList = createRequire(join(here, '..', 'daemon', 'package.json')).resolve('ps-list');
await cp(join(dirname(psList), 'vendor'), join(here, 'dist', 'vendor'), { recursive: true });

process.stdout.write('built dist/main.cjs, dist/preload.cjs, dist/vendor\n');
