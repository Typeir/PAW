#!/usr/bin/env node
/**
 * PAW Build Script
 *
 * Bundles PAW into portable .mjs files using esbuild (zero new deps — transitive via tsx).
 *
 * Three build passes:
 *   1. CLI: packages/cli (the hex CLI) → dist/cli.mjs
 *   2. Hooks: Multiple entries with code-splitting → dist/hooks/*.mjs + dist/hooks/chunk-*.mjs
 *   3. Workers: Background processes spawned by hooks → dist/workers/*.mjs
 *
 * Passes 2 and 3 still bundle the legacy flat modules (hooks/, pawDb.ts). They
 * move into packages/ with the hook migration; until then both trees are live
 * and the legacy one may not be deleted.
 *
 * Usage: node build.mjs
 */

import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, 'dist');

/* ------------------------------------------------------------------ */
/*  Clean dist/                                                       */
/* ------------------------------------------------------------------ */
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

/* ------------------------------------------------------------------ */
/*  Shared esbuild options                                            */
/* ------------------------------------------------------------------ */
const shared = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  sourcemap: false,
  minify: false,
  // Mark Node builtins and runtime deps as external
  external: [
    'node:*',
    // sql.js uses CJS internals (__dirname, require) — must remain external
    'sql.js',
    // copilot-sdk is optional runtime dep
    '@github/copilot-sdk',
  ],
};

/* ------------------------------------------------------------------ */
/*  Pass 1: CLI — single self-contained bundle                       */
/* ------------------------------------------------------------------ */
console.log('Building CLI...');

/**
 * The banner every executable bundle carries.
 *
 * The bundle is ESM but pulls in CommonJS dependencies — `ws`, by way of the
 * daemon's websocket server. esbuild rewrites their `require()` calls to a shim
 * that throws unless a real `require` is in scope, so the banner builds one.
 * Without it the binary dies on load with `Dynamic require of "events" is not
 * supported`, before routing a single command.
 *
 * @returns {string} The banner source.
 */
function executableBanner() {
  return [
    '#!/usr/bin/env node',
    "import { createRequire as __pawCreateRequire } from 'node:module';",
    'const require = __pawCreateRequire(import.meta.url);',
  ].join('\n');
}

/**
 * Bundle the hex CLI, which is the shipped `paw` binary.
 *
 * It parses argv and self-executes, so it is its own entry: the generated
 * wrapper this pass used to need existed only to give the legacy filesystem
 * command loader a static registry, and the hex CLI routes with a plain
 * if-chain instead.
 *
 * The unresolvable dynamic `import()` warnings esbuild prints here are correct
 * and must not be "fixed" — they are the user-supplied swarm plan files that
 * `packages/cli` and `packages/daemon` load by path at runtime, and bundling
 * those would mean baking someone's plan into the binary.
 *
 * @returns {Promise<void>} Settles when the bundle is written.
 */
async function buildCli() {
  await build({
    ...shared,
    entryPoints: [join(__dirname, 'packages', 'cli', 'src', 'main.ts')],
    outfile: join(DIST, 'cli.mjs'),
    splitting: false,
    banner: { js: executableBanner() },
  });
}

await buildCli();

console.log('  → dist/cli.mjs');

/* ------------------------------------------------------------------ */
/*  Pass 1b: Installer — the bootstrap binary                         */
/* ------------------------------------------------------------------ */
console.log('Building installer...');

/**
 * Bundle `paw-setup`.
 *
 * A second binary rather than a `paw` subcommand because it runs before `paw`
 * is reachable: it is what puts PAW on PATH and attaches it to a repository. A
 * subcommand of an unreachable binary cannot bootstrap anything.
 *
 * @returns {Promise<void>} Settles when the bundle is written.
 */
async function buildInstaller() {
  await build({
    ...shared,
    entryPoints: [join(__dirname, 'packages', 'installer', 'src', 'main.ts')],
    outfile: join(DIST, 'paw-setup.mjs'),
    splitting: false,
    banner: { js: '#!/usr/bin/env node' },
  });
}

await buildInstaller();

console.log('  → dist/paw-setup.mjs');

/* ------------------------------------------------------------------ */
/*  Pass 2: Hooks — multiple entries with code-splitting              */
/* ------------------------------------------------------------------ */
console.log('Building hooks...');

const hookEntries = [
  'hooks/postToolUse.ts',
  'hooks/preToolUse.ts',
  'hooks/sessionEndHealth.ts',
  'hooks/sessionEndMemorySave.ts',
  'hooks/sessionEndMissingTests.ts',
  'hooks/userPromptSubmitted.ts',
].map((h) => join(__dirname, h));

await build({
  ...shared,
  entryPoints: hookEntries,
  outdir: join(DIST, 'hooks'),
  splitting: true,
  chunkNames: '_lib/[name]-[hash]',
  outExtension: { '.js': '.mjs' },
});

console.log('  → dist/hooks/*.mjs + dist/hooks/_lib/');

/* ------------------------------------------------------------------ */
/*  Pass 3: Workers — background processes spawned by hooks           */
/* ------------------------------------------------------------------ */
console.log('Building workers...');

const workerEntries = ['workers/memoryWorker.ts'].map((w) =>
  join(__dirname, w),
);

await build({
  ...shared,
  entryPoints: workerEntries,
  outdir: join(DIST, 'workers'),
  splitting: false,
  outExtension: { '.js': '.mjs' },
});

console.log('  → dist/workers/*.mjs');

/* ------------------------------------------------------------------ */
/*  Post-build: copy templates and docs                               */
/* ------------------------------------------------------------------ */
console.log('Copying assets...');

const templatesSrc = join(__dirname, 'templates');
const templatesDst = join(DIST, 'templates');
try {
  cpSync(templatesSrc, templatesDst, { recursive: true });
  console.log('  → dist/templates/');
} catch {
  console.log('  (no templates/ directory — skipped)');
}

const docsSrc = join(__dirname, 'docs');
const docsDst = join(DIST, 'docs');
try {
  cpSync(docsSrc, docsDst, { recursive: true });
  console.log('  → dist/docs/');
} catch {
  console.log('  (no docs/ directory — skipped)');
}

/* ------------------------------------------------------------------ */
/*  Post-build: copy default gates                                    */
/* ------------------------------------------------------------------ */
const gatesSrc = join(__dirname, 'gates');
const gatesDst = join(DIST, 'gates');
try {
  cpSync(gatesSrc, gatesDst, { recursive: true });
  console.log('  → dist/gates/');
} catch {
  console.log('  (no gates/ directory — skipped)');
}

/* ------------------------------------------------------------------ */
/*  Post-build: copy the console page                                 */
/* ------------------------------------------------------------------ */
/**
 * Copy the built console beside the bundle.
 *
 * `@paw/gui` inlines React and its whole console into one self-contained file,
 * so shipping the console is copying one page rather than an asset tree. It has
 * to travel with the bundle: `consolePage()` looks beside the artifact first,
 * and the source-checkout fallback it tries next does not exist once installed.
 *
 * Built separately by `npm run build:console`. Absent here means the console
 * falls back to the daemon's bootstrap page, loudly, at runtime.
 */
function copyConsolePage() {
  try {
    const consoleSrc = join(__dirname, 'packages', 'gui', 'dist', 'live.html');
    const consoleDst = join(DIST, 'gui', 'live.html');
    mkdirSync(dirname(consoleDst), { recursive: true });
    cpSync(consoleSrc, consoleDst);
    console.log('  → dist/gui/live.html');
  } catch {
    console.log('  (packages/gui/dist/live.html — skipped; run npm run build:console)');
  }
}

copyConsolePage();

/* ------------------------------------------------------------------ */
/*  Post-build: copy the fastlist binaries                            */
/* ------------------------------------------------------------------ */
/**
 * Copy the `fastlist` binaries beside the bundle.
 *
 * `ps-list` shells out to a small `fastlist` binary it locates beside its own
 * module. Bundled, "its own module" is `dist/cli.mjs`, so the binaries are
 * copied to `dist/vendor` — without them the daemon cannot read the host
 * process table and `paw ui` refuses to start.
 *
 * The same fix the Electron shell already makes for the same reason; see
 * `packages/electron/build.mjs`.
 */
function copyFastlist() {
  const psList = createRequire(
    join(__dirname, 'packages', 'daemon', 'package.json'),
  ).resolve('ps-list');
  cpSync(join(dirname(psList), 'vendor'), join(DIST, 'vendor'), {
    recursive: true,
  });
  console.log('  → dist/vendor/');
}

copyFastlist();

/* ------------------------------------------------------------------ */
/*  Post-build: copy gate wrapper                                     */
/* ------------------------------------------------------------------ */
try {
  const wrapperSrc = join(__dirname, 'gateWrapper.ts');
  const wrapperDst = join(DIST, 'gateWrapper.ts');
  cpSync(wrapperSrc, wrapperDst);
  console.log('  → dist/gateWrapper.ts');
} catch {
  console.log('  (gateWrapper.ts — skipped)');
}

/* ------------------------------------------------------------------ */
/*  Post-build: copy gate support files                               */
/* ------------------------------------------------------------------ */
const supportFiles = ['gateContext.ts', 'healthCheckTypes.ts', 'tsconfig.json'];
for (const file of supportFiles) {
  try {
    const src = join(__dirname, file);
    const dst = join(DIST, file);
    cpSync(src, dst);
    console.log(`  → dist/${file}`);
  } catch {
    console.log(`  (${file} — skipped)`);
  }
}

console.log('\nBuild complete!');
