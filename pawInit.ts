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
 * @author PAW
 * @version 1.0.0
 * @since 3.0.0
 */

import * as p from '@clack/prompts';
import { execSync } from 'node:child_process';
import {
    appendFileSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { openDb } from './paw-db';
import * as logger from './paw-logger';
import {
    DB_PATH,
    GATES_DIR,
    HOOKS_DIR,
    PAW_CORE_DIR,
    PAW_DIR,
    PAW_TSCONFIG,
    PAW_TSCONFIG_REL,
    PAW_TSCONFIG_TEMPLATE,
    PAWIGNORE_PATH,
    PROJECT_ROOT,
} from './paw-paths';

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
 * @author PAW
 * @version 1.0.0
 * @since 3.0.0
 */

import type { QualityGate, GateContext, GateResult } from '../../.github/PAW/health-check-types';

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
 * Ensure PAW's own dependencies are installed in .github/PAW/node_modules/.
 * PAW is self-contained — it must not rely on the host project's node_modules.
 * Skips install when node_modules already exists.
 */
function installPawDeps(): void {
  const nodeModulesPath = path.join(PAW_CORE_DIR, 'node_modules');
  if (existsSync(nodeModulesPath)) {
    logger.info('PAW deps — already installed, skipped');
    return;
  }
  logger.info('Installing PAW dependencies in .github/PAW/ ...');
  execSync('npm install --prefer-offline', {
    cwd: PAW_CORE_DIR,
    stdio: 'inherit',
    timeout: 60000,
  });
  logger.success('PAW deps installed');
}

/**
 * Copy the tsconfig template from .github/PAW/templates/ into .paw/.
 */
function scaffoldTsconfig(): void {
  if (existsSync(PAW_TSCONFIG)) {
    logger.info('tsconfig.json already exists — skipped');
    return;
  }
  if (!existsSync(PAW_TSCONFIG_TEMPLATE)) {
    logger.warn(
      'tsconfig template not found at .github/PAW/templates/tsconfig.json',
    );
    return;
  }
  copyFileSync(PAW_TSCONFIG_TEMPLATE, PAW_TSCONFIG);
  logger.success('Created .paw/tsconfig.json');
}

/**
 * Run paw sync to copy default hooks and generate hooks.json.
 */
function runSync(): void {
  try {
    execSync(`npx tsx --tsconfig ${PAW_TSCONFIG_REL} .github/PAW/pawSync.ts`, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      timeout: 30000,
    });
  } catch {
    logger.warn('Hook sync failed — run "npx paw sync" manually');
  }
}

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

  s.start('Checking PAW dependencies');
  installPawDeps();
  s.stop('✅ PAW deps ready');

  s.start('Scaffolding .paw/ directory');
  scaffoldDirectories();
  scaffoldTsconfig();
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
      execSync(
        `npx tsx --tsconfig ${PAW_TSCONFIG_REL} .github/PAW/pawHooks.ts install`,
        {
          cwd: PROJECT_ROOT,
          stdio: 'inherit',
          timeout: 15000,
        },
      );
      s.stop('✅ Git hooks installed');
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
