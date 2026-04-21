#!/usr/bin/env node
/**
 * PAW Build Script
 *
 * Bundles PAW into portable .mjs files using esbuild (zero new deps — transitive via tsx).
 *
 * Two build passes:
 *   1. CLI: Single self-contained bundle → dist/cli.mjs
 *   2. Hooks: Multiple entries with code-splitting → dist/hooks/*.mjs + dist/hooks/chunk-*.mjs
 *
 * Usage: node build.mjs
 */

import { build } from 'esbuild';
import {
    cpSync,
    mkdirSync,
    rmSync,
    writeFileSync
} from 'node:fs';
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
    // @clack/prompts is a runtime dep (ships in node_modules)
    '@clack/prompts',
    // copilot-sdk is optional runtime dep
    '@github/copilot-sdk',
  ],
};

/* ------------------------------------------------------------------ */
/*  Pass 1: CLI — single self-contained bundle                       */
/* ------------------------------------------------------------------ */
console.log('Building CLI...');

// For the CLI build, we need a static entry that doesn't use dynamic import().
// Create a temporary entry that uses the static command registry.
const cliBundleEntry = join(__dirname, '_cli-entry.ts');
writeFileSync(
  cliBundleEntry,
  `import { log } from '@clack/prompts';
import { buildStaticRegistry } from './cli/commandRegistry';
import { LOGO, printHelp } from './cli/help';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const rest = argv.slice(1);

  if (!command) {
    console.log(LOGO);
    printHelp();
    return;
  }

  const registry = buildStaticRegistry();
  const match = registry.commands.get(command);

  if (match) {
    await match.run(rest);
  } else {
    log.error(\`Unknown command: \${command}\`);
    printHelp();
  }
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
`,
);

try {
  await build({
    ...shared,
    entryPoints: [cliBundleEntry],
    outfile: join(DIST, 'cli.mjs'),
    splitting: false,
    banner: { js: '#!/usr/bin/env node' },
  });
} finally {
  rmSync(cliBundleEntry, { force: true });
}

console.log('  → dist/cli.mjs');

/* ------------------------------------------------------------------ */
/*  Pass 2: Hooks — multiple entries with code-splitting              */
/* ------------------------------------------------------------------ */
console.log('Building hooks...');

const hookEntries = [
  'hooks/memoryWorker.ts',
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
const supportFiles = ['gateContext.ts', 'healthCheckTypes.ts'];
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
