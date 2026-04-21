/**
 * PAW Init Bootstrapper
 *
 * @fileoverview Interactive CLI that scaffolds a .paw/ directory in the current
 * project. Creates the folder structure, starter gates, .pawignore, hooks.json,
 * initializes paw.sqlite, and optionally installs Git hooks.
 *
 * Usage:
 *   npx tsx .github/PAW/pawInit.ts
 *
 * @module .github/PAW/pawInit
 * @author Typeir
 * @version 1.0.0
 * @since 3.0.0
 */

import * as p from '@clack/prompts';
import {
    appendFileSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { openDb } from './pawDb';
import * as logger from './pawLogger';
import {
    DB_PATH,
    GATES_DIR,
    HOOKS_DIR,
    PAW_CORE_DIR,
    PAW_DIR,
    PAWIGNORE_PATH,
    PROJECT_ROOT,
} from './pawPaths';

/**
 * Default .pawignore content for new projects.
 */
const DEFAULT_PAWIGNORE = `# PAW ignore patterns — one per line, glob syntax
# Lines starting with # are comments

node_modules
.next
.git
coverage
dist
.turbo
`;

/**
 * Starter gate template — a minimal passing gate for reference.
 */
const STARTER_GATE = `/**
 * Example Quality Gate
 *
 * @fileoverview Starter gate scaffolded by paw init. Replace with your own checks.
 *
 * @module .paw/gates/example
 * @author Typeir
 * @version 1.0.0
 * @since 3.0.0
 */

import type { QualityGate, GateContext, GateResult } from './healthCheckTypes';

/**
 * Example gate that always passes.
 */
export const gate: QualityGate = {
  id: 'example',
  name: 'Example Gate',
  port: 'custom',
  severity: 'warning',
  appliesTo: ['.ts', '.tsx'],

  async check(context: GateContext): Promise<GateResult> {
    const files = await context.targetFiles(this.appliesTo);
    const start = performance.now();

    return {
      gate: this.id,
      passed: true,
      severity: 'info',
      findings: [],
      stats: {
        filesChecked: files.length,
        findingsCount: 0,
        durationMs: Math.round(performance.now() - start),
      },
    };
  },
};
`;

/**
 * Ensure .paw/ is listed in .gitignore so the DB and logs aren't committed.
 */
function ensureGitignore(): void {
  const gitignorePath = path.join(PROJECT_ROOT, '.gitignore');
  if (!existsSync(gitignorePath)) return;

  const content = readFileSync(gitignorePath, 'utf-8');
  if (content.includes('.paw/') || content.includes('.paw')) return;

  appendFileSync(gitignorePath, '\n# PAW installed data\n.paw/\n', 'utf-8');
  logger.success('Added .paw/ to .gitignore');
}

/**
 * Scaffold the .paw/ directory structure.
 */
function scaffoldDirectories(): void {
  mkdirSync(GATES_DIR, { recursive: true });
  logger.success('Created .paw/gates/');
}

/**
 * Write the starter example gate if no gates exist yet.
 */
function scaffoldStarterGate(): void {
  const examplePath = path.join(GATES_DIR, 'example.gate.ts');
  if (existsSync(examplePath)) {
    logger.info('example.gate.ts already exists — skipped');
    return;
  }
  writeFileSync(examplePath, STARTER_GATE, 'utf-8');
  logger.success('Created example.gate.ts starter');
}

/**
 * Create .pawignore at project root if it doesn't exist.
 */
function scaffoldPawignore(): void {
  if (existsSync(PAWIGNORE_PATH)) {
    logger.info('.pawignore already exists — skipped');
    return;
  }
  writeFileSync(PAWIGNORE_PATH, DEFAULT_PAWIGNORE, 'utf-8');
  logger.success('Created .pawignore');
}

/**
 * Copy compiled hooks from PAW dist into .paw/hooks/ via sync logic.
 */
function runSync(): void {
  try {
    const hooksSource = path.join(PAW_CORE_DIR, 'hooks');
    if (!existsSync(hooksSource)) {
      logger.warn('No compiled hooks found — run sync manually after build');
      return;
    }
    mkdirSync(HOOKS_DIR, { recursive: true });
    const files = readdirSync(hooksSource).filter((f: string) =>
      f.endsWith('.mjs'),
    );
    for (const file of files) {
      copyFileSync(path.join(hooksSource, file), path.join(HOOKS_DIR, file));
    }
    // Copy _lib/ chunks
    const libSrc = path.join(hooksSource, '_lib');
    if (existsSync(libSrc)) {
      const libDest = path.join(HOOKS_DIR, '_lib');
      mkdirSync(libDest, { recursive: true });
      const libFiles = readdirSync(libSrc).filter((f: string) =>
        f.endsWith('.mjs'),
      );
      for (const file of libFiles) {
        copyFileSync(path.join(libSrc, file), path.join(libDest, file));
      }
    }
    logger.success(`Hooks synced (${files.length} hooks copied)`);
  } catch {
    logger.warn('Hook sync failed — run "paw sync" manually');
  }
}

/**
 * Scaffold .paw/hooks/ directory.
 */
function scaffoldHooksDir(): void {
  mkdirSync(HOOKS_DIR, { recursive: true });
  logger.success('Created .paw/hooks/');
}

/**
 * Initialize paw.sqlite with schema.
 */
function initializeDatabase(): void {
  mkdirSync(PAW_DIR, { recursive: true });
  const db = openDb(DB_PATH);
  db.close();
  logger.success('Initialized paw.sqlite');
}

/**
 * Main bootstrapper flow.
 */
async function main(): Promise<void> {
  logger.pawIntro('PAW Init');

  if (existsSync(PAW_DIR)) {
    const shouldContinue = await p.confirm({
      message:
        '.paw/ already exists. Re-initialize? (existing data is preserved)',
    });
    if (p.isCancel(shouldContinue) || !shouldContinue) {
      logger.pawOutro('Cancelled');
      return;
    }
  }

  const options = await p.group(
    {
      starterGate: () =>
        p.confirm({
          message: 'Create a starter example gate?',
          initialValue: true,
        }),
      hooksJson: () =>
        p.confirm({
          message: 'Sync default hooks to .paw/hooks/ and generate hooks.json?',
          initialValue: true,
        }),
      pawignore: () =>
        p.confirm({
          message: 'Create .pawignore with default patterns?',
          initialValue: true,
        }),
      gitignore: () =>
        p.confirm({
          message: 'Add .paw/ to .gitignore?',
          initialValue: true,
        }),
      gitHooks: () =>
        p.confirm({
          message: 'Install pre-commit / pre-push Git hooks?',
          initialValue: false,
        }),
    },
    {
      onCancel: () => {
        logger.pawOutro('Cancelled');
        process.exit(0);
      },
    },
  );

  const s = logger.spin();

  s.start('Scaffolding .paw/ directory');
  scaffoldDirectories();
  s.stop('✅ .paw/ directory ready');

  if (options.starterGate) {
    scaffoldStarterGate();
  }

  if (options.pawignore) {
    scaffoldPawignore();
  }

  if (options.hooksJson) {
    s.start('Syncing hooks');
    scaffoldHooksDir();
    runSync();
    s.stop('\u2705 Hooks synced');
  }

  s.start('Initializing database');
  initializeDatabase();
  s.stop('✅ Database ready');

  if (options.gitignore) {
    ensureGitignore();
  }

  if (options.gitHooks) {
    s.start('Installing Git hooks');
    try {
      // TODO: Git hooks installation via bundled CLI
      logger.warn('Git hook installation not yet available in compiled mode');
      s.stop('⚠️ Git hooks — skipped (run manually)');
    } catch {
      s.stop(
        '⚠️ Git hook installation failed — run "paw hooks:install" manually',
      );
    }
  }

  logger.pawOutro(
    'PAW initialized! Run "npx paw sync" to update hooks, or "npx paw gates" for quality gates.',
  );
}

main().catch((err: Error) => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
