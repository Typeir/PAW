/**
 * PAW Sync Command
 *
 * @fileoverview Synchronizes the .paw/ installation directory. Copies default
 * hooks from .github/PAW/hooks/ into .paw/hooks/ (without overwriting
 * user-customized files), and regenerates hook configs for the selected
 * Copilot surface(s) via the adapter layer.
 *
 * Surface selection:
 *   - env var PAW_SURFACE=cli|extension|sdk|all (highest precedence)
 *   - .paw/config.json { "surface": "cli" }
 *   - Defaults to "extension" when no config is found
 *
 * Usage:
 *   npx tsx .github/PAW/pawSync.ts          # full sync (default surface)
 *   npx tsx .github/PAW/pawSync.ts --force  # overwrite existing hooks
 *   PAW_SURFACE=all npx tsx .github/PAW/pawSync.ts  # generate all surfaces
 *
 * @module .github/PAW/pawSync
 * @author PAW
 * @version 2.0.0
 * @since 3.0.0
 */

import { execSync } from 'node:child_process';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { CLIAdapter } from './adapters/cli.adapter';
import { ExtensionAdapter } from './adapters/extension.adapter';
import { SDKAdapter } from './adapters/sdk.adapter';
import type {
    PawConfig,
    PawHookDef,
    PawSurface,
    PawSurfaceAdapter,
} from './adapters/types';
import { PawEvent } from './adapters/types';
import * as logger from './paw-logger';
import {
    HOOKS_DIR,
    PAW_CORE_DIR,
    PAW_DIR,
    PAW_TSCONFIG,
    PAW_TSCONFIG_REL,
    PAW_TSCONFIG_TEMPLATE,
    PROJECT_ROOT,
} from './paw-paths';

/**
 * CLI flag: --force overwrites existing user hooks.
 */
const forceOverwrite = process.argv.includes('--force');

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
 * Source directory for default hook implementations.
 * PAW core ships reference hooks; sync copies them into .paw/hooks/.
 */
const DEFAULT_HOOKS_SRC = path.join(PAW_CORE_DIR, 'hooks');

/**
 * Source directory for Copilot asset templates (skills, agents, prompts).
 * Synced into .github/ so VS Code discovers them natively.
 */
const ASSETS_TEMPLATE_DIR = path.join(PAW_CORE_DIR, 'templates');

/**
 * Copilot asset directories that PAW syncs into the project.
 * Each entry maps a templates/ subdirectory to its .github/ target.
 *
 * @interface AssetMapping
 * @property {string} templateSubdir - Subdirectory under templates/ (e.g. 'skills')
 * @property {string} targetDir - Target under .github/ (e.g. '.github/skills')
 */
interface AssetMapping {
  templateSubdir: string;
  targetDir: string;
}

/**
 * Copilot asset mappings — template subdirectories to .github/ targets.
 */
const ASSET_MAPPINGS: AssetMapping[] = [
  { templateSubdir: 'skills', targetDir: path.join(PROJECT_ROOT, '.github', 'skills') },
  { templateSubdir: 'agents', targetDir: path.join(PROJECT_ROOT, '.github', 'agents') },
  { templateSubdir: 'prompts', targetDir: path.join(PROJECT_ROOT, '.github', 'prompts') },
];

/**
 * Hook-to-event mapping. Defines which Copilot hook events each file serves.
 * Uses PAW canonical events instead of surface-specific names.
 *
 * @interface HookMapping
 * @property {string} file - Filename (no path) in .paw/hooks/
 * @property {PawEvent} event - PAW canonical event this hook serves
 * @property {number} timeoutSec - Max execution time before the surface kills the hook
 */
interface HookMapping {
  file: string;
  event: PawEvent;
  timeoutSec: number;
}

/**
 * Registry of default hooks and their event bindings.
 * Uses PAW canonical events; adapters translate to surface-specific names.
 * When adding a new hook to .github/PAW/hooks/, add a mapping here.
 */
const HOOK_REGISTRY: HookMapping[] = [
  { file: 'pre-tool-use.ts', event: PawEvent.ToolPre, timeoutSec: 10 },
  {
    file: 'user-prompt-submitted.ts',
    event: PawEvent.PromptSubmitted,
    timeoutSec: 10,
  },
  { file: 'post-tool-use.ts', event: PawEvent.ToolPost, timeoutSec: 15 },
  {
    file: 'session-end-memory-save.ts',
    event: PawEvent.SessionEnd,
    timeoutSec: 15,
  },
  {
    file: 'session-end-health.ts',
    event: PawEvent.SessionEnd,
    timeoutSec: 120,
  },
];

/**
 * Ensure .paw/tsconfig.json exists by copying the template if missing.
 */
function syncTsconfig(): void {
  if (existsSync(PAW_TSCONFIG) && !forceOverwrite) {
    logger.info(
      'tsconfig.json — already exists, skipped (use --force to overwrite)',
    );
    return;
  }
  if (!existsSync(PAW_TSCONFIG_TEMPLATE)) {
    logger.warn(
      'tsconfig template not found at .github/PAW/templates/tsconfig.json',
    );
    return;
  }
  copyFileSync(PAW_TSCONFIG_TEMPLATE, PAW_TSCONFIG);
  logger.success(
    `tsconfig.json — ${existsSync(PAW_TSCONFIG) && forceOverwrite ? 'overwritten' : 'copied'}`,
  );
}

/**
 * Copy default hooks from .github/PAW/hooks/ into .paw/hooks/.
 * Skips files that already exist unless --force is set.
 *
 * @returns Number of files copied
 */
function syncHooks(): number {
  mkdirSync(HOOKS_DIR, { recursive: true });

  if (!existsSync(DEFAULT_HOOKS_SRC)) {
    logger.warn(
      'No default hooks found at .github/PAW/hooks/ — skipping hook copy',
    );
    return 0;
  }

  const sourceFiles = readdirSync(DEFAULT_HOOKS_SRC).filter((f) =>
    f.endsWith('.ts'),
  );
  let copied = 0;

  for (const file of sourceFiles) {
    const src = path.join(DEFAULT_HOOKS_SRC, file);
    const dest = path.join(HOOKS_DIR, file);

    if (existsSync(dest) && !forceOverwrite) {
      logger.info(
        `${file} — already exists, skipped (use --force to overwrite)`,
      );
      continue;
    }

    copyFileSync(src, dest);
    copied++;
    logger.success(
      `${file} — ${existsSync(dest) && forceOverwrite ? 'overwritten' : 'copied'}`,
    );
  }

  return copied;
}

/**
 * Recursively copy a directory tree, preserving structure.
 * Skips files that already exist unless --force is set.
 *
 * @param {string} srcDir - Source directory
 * @param {string} destDir - Destination directory
 * @returns Number of files copied
 */
function copyDirRecursive(srcDir: string, destDir: string): number {
  if (!existsSync(srcDir)) return 0;

  mkdirSync(destDir, { recursive: true });
  const entries = readdirSync(srcDir, { withFileTypes: true });
  let copied = 0;

  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copied += copyDirRecursive(src, dest);
    } else {
      if (existsSync(dest) && !forceOverwrite) {
        continue;
      }
      copyFileSync(src, dest);
      copied++;
    }
  }

  return copied;
}

/**
 * Sync Copilot assets (skills, agents, prompts) from PAW templates
 * into .github/ so VS Code discovers them natively.
 * Skips files that already exist unless --force is set.
 *
 * @returns Number of files copied
 */
function syncAssets(): number {
  let totalCopied = 0;

  for (const mapping of ASSET_MAPPINGS) {
    const srcDir = path.join(ASSETS_TEMPLATE_DIR, mapping.templateSubdir);
    if (!existsSync(srcDir)) continue;

    const copied = copyDirRecursive(srcDir, mapping.targetDir);
    totalCopied += copied;

    if (copied > 0) {
      logger.success(
        `${mapping.templateSubdir} — ${copied} file(s) synced to .github/${mapping.templateSubdir}/`,
      );
    } else {
      logger.info(
        `${mapping.templateSubdir} — all files up to date (use --force to overwrite)`,
      );
    }
  }

  return totalCopied;
}

/**
 * Infer the PAW canonical event from a filename convention.
 * Filenames starting with the event prefix map to that event.
 *
 * @param filename - Hook filename (e.g. 'session-end-missing-tests.ts')
 * @returns PAW canonical event or null if unrecognized
 */
function inferPawEventFromFilename(filename: string): PawEvent | null {
  const name = filename.replace(/\.ts$/, '');
  if (name.startsWith('pre-tool-use')) return PawEvent.ToolPre;
  if (name.startsWith('post-tool-use')) return PawEvent.ToolPost;
  if (
    name.startsWith('user-prompt-submitted') ||
    name.startsWith('user-prompt')
  )
    return PawEvent.PromptSubmitted;
  if (name.startsWith('session-end')) return PawEvent.SessionEnd;
  if (name.startsWith('session-start')) return PawEvent.SessionStart;
  if (name.startsWith('subagent-start')) return PawEvent.SubagentStart;
  if (name.startsWith('subagent-stop')) return PawEvent.SubagentStop;
  if (name.startsWith('pre-compact') || name.startsWith('context-compact'))
    return PawEvent.ContextCompact;
  return null;
}

/**
 * Read the target surface from PAW_SURFACE env var or .paw/config.json.
 * Defaults to "extension" (VS Code is the primary surface).
 *
 * @returns Selected surface identifier
 */
function readSurfaceConfig(): PawSurface {
  const envSurface = process.env.PAW_SURFACE?.toLowerCase();
  if (envSurface && ['cli', 'extension', 'sdk', 'all'].includes(envSurface)) {
    return envSurface as PawSurface;
  }

  const configPath = path.join(PAW_DIR, 'config.json');
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as PawConfig;
      if (
        config.surface &&
        ['cli', 'extension', 'sdk', 'all'].includes(config.surface)
      ) {
        return config.surface;
      }
    } catch {
      logger.warn('Failed to parse .paw/config.json — using default surface');
    }
  }

  return 'extension';
}

/**
 * Resolve the set of adapters for the selected surface.
 *
 * @param surface - Target surface identifier
 * @returns Array of adapter instances
 */
function resolveAdapters(surface: PawSurface): PawSurfaceAdapter[] {
  const cli = new CLIAdapter(PAW_TSCONFIG_REL);
  const extension = new ExtensionAdapter(PAW_TSCONFIG_REL);
  const sdk = new SDKAdapter();

  switch (surface) {
    case 'cli':
      return [cli];
    case 'extension':
      return [extension];
    case 'sdk':
      return [sdk];
    case 'all':
      return [cli, extension, sdk];
  }
}

/**
 * Discover all .ts files in .paw/hooks/ and build PawHookDef array.
 * Uses HOOK_REGISTRY for known files; infers event from filename for
 * project-specific hooks not in the registry.
 *
 * @returns Array of PAW canonical hook definitions
 */
function discoverHookDefs(): PawHookDef[] {
  const installedFiles = existsSync(HOOKS_DIR)
    ? readdirSync(HOOKS_DIR).filter((f) => f.endsWith('.ts'))
    : [];

  if (installedFiles.length === 0) {
    logger.warn('No hooks found in .paw/hooks/ — hook configs will be empty');
  }

  const hookDefs: PawHookDef[] = [];

  for (const file of installedFiles) {
    const mapping = HOOK_REGISTRY.find((m) => m.file === file);
    const event = mapping?.event ?? inferPawEventFromFilename(file);
    const timeout = mapping?.timeoutSec ?? 30;

    if (!event) {
      logger.warn(`${file} — cannot infer event, skipped from hook config`);
      continue;
    }

    if (!mapping) {
      logger.info(`${file} — project hook, inferred event: ${event}`);
    }

    hookDefs.push({ file, event, timeoutSec: timeout });
  }

  return hookDefs;
}

/**
 * Detect whether a hook entry was generated by PAW.
 * PAW-managed entries have commands pointing into .paw/hooks/.
 *
 * @param entry - A hook entry object from hooks.json
 * @returns True if PAW generated this entry
 */
function isPawManagedEntry(entry: Record<string, unknown>): boolean {
  const cmd =
    (entry.command as string) ??
    (entry.bash as string) ??
    (entry.linux as string) ??
    '';
  return cmd.includes('.paw/hooks/');
}

/**
 * Merge PAW-generated hooks.json content with any pre-existing non-PAW
 * entries. PAW-managed entries (commands targeting .paw/hooks/) are replaced;
 * all other entries are preserved in their original position.
 *
 * @param existingContent - Current hooks.json content (JSON string), or null
 * @param newContent - PAW-generated hooks.json content (JSON string)
 * @returns Merged JSON string
 */
function mergeHooksJson(
  existingContent: string | null,
  newContent: string,
): string {
  const newJson = JSON.parse(newContent) as {
    version: number;
    hooks: Record<string, Record<string, unknown>[]>;
  };

  if (!existingContent) return JSON.stringify(newJson, null, 2);

  let existingJson: {
    version: number;
    hooks: Record<string, Record<string, unknown>[]>;
  };
  try {
    existingJson = JSON.parse(existingContent);
  } catch {
    logger.warn('Could not parse existing hooks.json — overwriting');
    return JSON.stringify(newJson, null, 2);
  }

  const merged: Record<string, Record<string, unknown>[]> = {};

  const allEvents = new Set([
    ...Object.keys(existingJson.hooks ?? {}),
    ...Object.keys(newJson.hooks ?? {}),
  ]);

  for (const event of allEvents) {
    const existingEntries = (existingJson.hooks?.[event] ?? []).filter(
      (e) => !isPawManagedEntry(e),
    );
    const pawEntries = newJson.hooks?.[event] ?? [];
    const combined = [...existingEntries, ...pawEntries];
    if (combined.length > 0) {
      merged[event] = combined;
    }
  }

  return JSON.stringify(
    { version: newJson.version, hooks: merged },
    null,
    2,
  );
}

/**
 * Generate hook configs for the selected surface(s) via adapter layer.
 * Discovers installed hooks, resolves adapters, and writes surface-specific
 * configuration files. Merges with existing non-PAW hooks instead of
 * overwriting.
 *
 * @param surface - Target surface identifier
 */
function generateSurfaceConfigs(surface: PawSurface): void {
  const hookDefs = discoverHookDefs();
  const adapters = resolveAdapters(surface);

  for (const adapter of adapters) {
    const output = adapter.generateHookConfig(hookDefs);
    const outputPath = path.join(PROJECT_ROOT, output.filePath);

    mkdirSync(path.dirname(outputPath), { recursive: true });

    const existingContent = existsSync(outputPath)
      ? readFileSync(outputPath, 'utf-8')
      : null;
    const mergedContent = mergeHooksJson(existingContent, output.content);

    writeFileSync(outputPath, mergedContent, 'utf-8');
    logger.success(
      `${adapter.name} → ${path.relative(process.cwd(), outputPath)}`,
    );
  }
}

/**
 * Main sync entrypoint.
 */
async function main(): Promise<void> {
  logger.pawIntro('PAW Sync');

  if (!existsSync(PAW_DIR)) {
    logger.error('.paw/ not found — run "npx paw init" first');
    process.exit(1);
  }

  const surface = readSurfaceConfig();
  const s = logger.spin();

  s.start('Checking PAW dependencies');
  installPawDeps();
  s.stop('✅ PAW deps ready');

  s.start('Syncing tsconfig');
  syncTsconfig();
  s.stop('✅ tsconfig synced');

  s.start('Syncing hooks');
  const copied = syncHooks();
  s.stop(`✅ Hooks synced (${copied} copied)`);

  s.start('Syncing Copilot assets (skills, agents, prompts)');
  const assetsCopied = syncAssets();
  s.stop(`✅ Copilot assets synced (${assetsCopied} copied)`);

  s.start(`Generating hook configs (surface: ${surface})`);
  generateSurfaceConfigs(surface);
  s.stop(`✅ Hook configs generated for ${surface}`);

  logger.pawOutro('Sync complete');
}

main().catch((err: Error) => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
