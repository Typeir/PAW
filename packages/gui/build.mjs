/**
 * PAW GUI Build
 *
 * @fileoverview Bundles the React console and everything it consumes — including
 * `@paw/core` — into one self-contained page: no external requests, so it runs
 * from a file and satisfies an artifact host's and Electron's strict CSP. A small
 * resolve plugin rewrites the `.js` specifiers the sources use (TS ESM
 * convention) to the `.ts`/`.tsx` files esbuild reads, the same rewrite tsx does
 * at runtime for the CLI and the daemon.
 *
 * Three targets, and the difference between them is the honest one:
 *
 * - `dist/index.html`   — standalone, with the demo snapshot injected. No daemon,
 *                         no network: `connect-src 'none'`.
 * - `dist/artifact.html`— the same page body-only, for publishing.
 * - `dist/live.html`    — the same bundle with **no** injected snapshot, so the
 *                         shell fetches `/api/state` and keeps polling. This is
 *                         the page `pawd` serves; `connect-src 'self'`.
 *
 * @module @paw/gui/build
 */

import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoSnapshot } from './demo/spellLore.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');

/**
 * Rewrite relative `*.js` imports to the co-located TypeScript source.
 */
const tsResolve = {
  name: 'ts-resolve',
  setup(builder) {
    builder.onResolve({ filter: /\.js$/ }, (args) => {
      if (args.kind === 'entry-point' || !args.path.startsWith('.')) {
        return undefined;
      }
      const base = join(args.resolveDir, args.path.replace(/\.js$/, ''));
      for (const ext of ['.tsx', '.ts']) {
        if (existsSync(base + ext)) {
          return { path: base + ext };
        }
      }
      return undefined;
    });
  },
};

const bundle = await build({
  entryPoints: [join(here, 'src', 'main.tsx')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  write: false,
  plugins: [tsResolve],
});
const appJs = bundle.outputFiles[0].text;

const DATA = `window.__PAW_DATA__ = ${JSON.stringify(demoSnapshot())};`;

const FOUC = `(function(){var d=matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-theme', d?'dark':'light');})();`;

/**
 * The page's own Content-Security-Policy, authoritative for a `file://`
 * document as defence in depth behind a host's response header. The bundle is
 * inline, so inline script and style are granted and nothing else is.
 *
 * @param {string} connect - The `connect-src` value: `'none'` static, `'self'` live.
 * @returns {string} The policy.
 */
const csp = (connect) =>
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  `img-src 'self' data:; font-src 'self' data:; connect-src ${connect}; ` +
  "base-uri 'none'; form-action 'none'";

/**
 * Wrap a body in a standalone document.
 *
 * @param {string} body - The document body.
 * @param {string} connect - The `connect-src` value.
 * @returns {string} The full page.
 */
const page = (body, connect) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp(connect)}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PAW console</title>
<script>${FOUC}</script>
</head>
<body>
${body}</body>
</html>
`;

const staticBody = `<div id="app"></div>\n<script>${DATA}</script>\n<script>${appJs}</script>\n`;
const liveBody = `<div id="app"></div>\n<script>${appJs}</script>\n`;

await mkdir(dist, { recursive: true });
await writeFile(join(dist, 'index.html'), page(staticBody, "'none'"), 'utf8');
await writeFile(join(dist, 'artifact.html'), staticBody, 'utf8');
await writeFile(join(dist, 'live.html'), page(liveBody, "'self'"), 'utf8');

const kb = (text) => (text.length / 1024).toFixed(1);
process.stdout.write(
  `built ${kb(appJs)}kb bundle → dist/index.html (+${kb(DATA)}kb demo data), dist/artifact.html, dist/live.html\n`,
);
