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
 *   npx tsx .github/PAW/pawSync.ts          # full sync
 *   PAW_SURFACE=all npx tsx .github/PAW/pawSync.ts  # generate all surfaces
 *
 * @module .github/PAW/pawSync
 * @author Typeir
 * @version 2.0.0
 * @since 3.0.0
 */

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
import * as logger from './pawLogger';
import { HOOKS_DIR, PAW_CORE_DIR, PAW_DIR, PROJECT_ROOT } from './pawPaths';

/**
 * Source directory for compiled hook bundles.
 * After build, compiled .mjs hooks live at dist/hooks/ relative to PAW_CORE_DIR.
 * During development (unbundled), they're at hooks/ relative to PAW_CORE_DIR.
 */
const DEFAULT_HOOKS_SRC = existsSync(path.join(PAW_CORE_DIR, 'hooks'))
  ? path.join(PAW_CORE_DIR, 'hooks')
  : path.join(PAW_CORE_DIR, 'dist', 'hooks');

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
  {
    templateSubdir: 'skills',
    targetDir: path.join(PROJECT_ROOT, '.github', 'skills'),
  },
  {
    templateSubdir: 'agents',
    targetDir: path.join(PROJECT_ROOT, '.github', 'agents'),
  },
  {
    templateSubdir: 'prompts',
    targetDir: path.join(PROJECT_ROOT, '.github', 'prompts'),
  },
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
  { file: 'preToolUse.mjs', event: PawEvent.ToolPre, timeoutSec: 10 },
  {
    file: 'userPromptSubmitted.mjs',
    event: PawEvent.PromptSubmitted,
    timeoutSec: 10,
  },
  { file: 'postToolUse.mjs', event: PawEvent.ToolPost, timeoutSec: 15 },
  {
    file: 'sessionEndMemorySave.mjs',
    event: PawEvent.SessionEnd,
    timeoutSec: 15,
  },
  {
    file: 'sessionEndHealth.mjs',
    event: PawEvent.SessionEnd,
    timeoutSec: 120,
  },
  {
    file: 'sessionEndMissingTests.mjs',
    event: PawEvent.SessionEnd,
    timeoutSec: 30,
  },
];

/**
 * Copy compiled .mjs hooks from PAW dist/hooks/ into .paw/hooks/.
 * Also copies _lib/ shared chunks needed by the hooks.
 * Always overwrites existing files to keep hooks in sync.
 *
 * @returns {number} Number of files copied
 */
function syncHooks(): number {
  mkdirSync(HOOKS_DIR, { recursive: true });

  if (!existsSync(DEFAULT_HOOKS_SRC)) {
    logger.warn(
      'No compiled hooks found — run "node build.mjs" first, or check your PAW installation',
    );
    return 0;
  }

  const sourceFiles = readdirSync(DEFAULT_HOOKS_SRC).filter((f) =>
    f.endsWith('.mjs'),
  );
  let copied = 0;

  for (const file of sourceFiles) {
    const src = path.join(DEFAULT_HOOKS_SRC, file);
    const dest = path.join(HOOKS_DIR, file);

    copyFileSync(src, dest);
    copied++;
    logger.success(`${file} — synced`);
  }

  copied += syncLibChunks();

  return copied;
}

/**
 * Copy the `_lib/` shared chunk directory from `DEFAULT_HOOKS_SRC` into
 * `.paw/hooks/_lib/`. Content-hashed filenames are overwritten unconditionally
 * so consumers always resolve to the freshest chunks.
 *
 * @returns {number} Count of chunk files copied (0 when no _lib/ source)
 */
function syncLibChunks(): number {
  const libSrc = path.join(DEFAULT_HOOKS_SRC, '_lib');
  if (!existsSync(libSrc)) return 0;

  const libDest = path.join(HOOKS_DIR, '_lib');
  mkdirSync(libDest, { recursive: true });
  const libFiles = readdirSync(libSrc).filter((f) => f.endsWith('.mjs'));
  for (const file of libFiles) {
    copyFileSync(path.join(libSrc, file), path.join(libDest, file));
  }
  logger.success(`_lib/ — ${libFiles.length} shared chunk(s) synced`);
  return libFiles.length;
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
      copyFileSync(src, dest);
      copied++;
    }
  }

  return copied;
}

/**
 * Sync runtime dependencies (sql.js) into .paw/node_modules/ so compiled
 * hooks can resolve external packages. This is the portability mechanism —
 * hooks don't need a global npm install, they find deps in .paw/node_modules/.
 */
function syncRuntimeDeps(): void {
  const candidates = [
    path.join(PAW_CORE_DIR, 'node_modules'),
    path.join(PAW_CORE_DIR, '..', 'node_modules'),
  ];
  const nodeModulesSrc = candidates.find((p) =>
    existsSync(path.join(p, 'sql.js')),
  );

  if (!nodeModulesSrc) {
    logger.warn(
      'sql.js not found in PAW node_modules — hooks may fail to resolve it',
    );
    return;
  }

  const nodeModulesDest = path.join(PAW_DIR, 'node_modules');
  const sqlJsSrc = path.join(nodeModulesSrc, 'sql.js');
  const sqlJsDest = path.join(nodeModulesDest, 'sql.js');
  mkdirSync(sqlJsDest, { recursive: true });

  copySqlJsPackage(sqlJsSrc, sqlJsDest);

  logger.success('sql.js → .paw/node_modules/sql.js/');
}

/**
 * Copy the minimum subset of a sql.js package (its `package.json` and the
 * `sql-wasm*` build artifacts) from source into destination. This is the
 * runtime portability surface — consumers need only these files to boot
 * sql.js from `.paw/node_modules/`.
 *
 * @param {string} sqlJsSrc - Source sql.js directory (inside a node_modules tree)
 * @param {string} sqlJsDest - Destination sql.js directory inside `.paw/node_modules/`
 */
function copySqlJsPackage(sqlJsSrc: string, sqlJsDest: string): void {
  copyFileSync(
    path.join(sqlJsSrc, 'package.json'),
    path.join(sqlJsDest, 'package.json'),
  );

  const distSrc = path.join(sqlJsSrc, 'dist');
  const distDest = path.join(sqlJsDest, 'dist');
  mkdirSync(distDest, { recursive: true });

  for (const file of readdirSync(distSrc)) {
    if (file.startsWith('sql-wasm')) {
      copyFileSync(path.join(distSrc, file), path.join(distDest, file));
    }
  }
}

/**
 * Sync Copilot assets (skills, agents, prompts) from PAW templates
 * into .github/ so VS Code discovers them natively.
 * Skips files that already exist unless --force is set.
 *
 * @returns {number} Number of files copied
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
 * @param {string} filename - Hook filename (e.g. 'session-end-missing-tests.ts')
 * @returns {PawEvent | null} PAW canonical event or null if unrecognized
 */
function inferPawEventFromFilename(filename: string): PawEvent | null {
  const name = filename.replace(/\.(mjs|ts)$/, '');
  if (name.startsWith('preToolUse') || name.startsWith('pre-tool-use'))
    return PawEvent.ToolPre;
  if (name.startsWith('postToolUse') || name.startsWith('post-tool-use'))
    return PawEvent.ToolPost;
  if (
    name.startsWith('userPromptSubmitted') ||
    name.startsWith('userPrompt') ||
    name.startsWith('user-prompt-submitted') ||
    name.startsWith('user-prompt')
  )
    return PawEvent.PromptSubmitted;
  if (name.startsWith('sessionEnd') || name.startsWith('session-end'))
    return PawEvent.SessionEnd;
  if (name.startsWith('sessionStart') || name.startsWith('session-start'))
    return PawEvent.SessionStart;
  if (name.startsWith('subagentStart') || name.startsWith('subagent-start'))
    return PawEvent.SubagentStart;
  if (name.startsWith('subagentStop') || name.startsWith('subagent-stop'))
    return PawEvent.SubagentStop;
  if (
    name.startsWith('preCompact') ||
    name.startsWith('contextCompact') ||
    name.startsWith('pre-compact') ||
    name.startsWith('context-compact')
  )
    return PawEvent.ContextCompact;
  return null;
}

/**
 * Read the target surface from PAW_SURFACE env var or .paw/config.json.
 * Defaults to "extension" (VS Code is the primary surface).
 *
 * @returns {PawSurface} Selected surface identifier
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
 * @param {PawSurface} surface - Target surface identifier
 * @returns {PawSurfaceAdapter[]} Array of adapter instances
 */
function resolveAdapters(surface: PawSurface): PawSurfaceAdapter[] {
  const cli = new CLIAdapter();
  const extension = new ExtensionAdapter();
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
 * @returns {PawHookDef[]} Array of PAW canonical hook definitions
 */
function discoverHookDefs(): PawHookDef[] {
  const installedFiles = existsSync(HOOKS_DIR)
    ? readdirSync(HOOKS_DIR).filter((f) => f.endsWith('.mjs'))
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
 * @param {Record<string, unknown>} entry - A hook entry object from hooks.json
 * @returns {boolean} True if PAW generated this entry
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
 * @param {string | null} existingContent - Current hooks.json content (JSON string), or null
 * @param {string} newContent - PAW-generated hooks.json content (JSON string)
 * @returns {string} Merged JSON string
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

  return JSON.stringify({ version: newJson.version, hooks: merged }, null, 2);
}

/**
 * Generate hook configs for the selected surface(s) via adapter layer.
 * Discovers installed hooks, resolves adapters, and writes surface-specific
 * configuration files. Merges with existing non-PAW hooks instead of
 * overwriting.
 *
 * @param {PawSurface} surface - Target surface identifier
 */
function generateSurfaceConfigs(surface: PawSurface): void {
  const hookDefs = discoverHookDefs();
  const adapters = resolveAdapters(surface);

  for (const adapter of adapters) {
    const output = adapter.generateHookConfig(hookDefs);
    const outputPath = path.join(PROJECT_ROOT, output.filePath);

    mkdirSync(path.dirname(outputPath), { recursive: true });

    const isJsonOutput = output.filePath.endsWith('.json');
    let finalContent: string;
    if (isJsonOutput) {
      const existingContent = existsSync(outputPath)
        ? readFileSync(outputPath, 'utf-8')
        : null;
      finalContent = mergeHooksJson(existingContent, output.content);
    } else {
      finalContent = output.content;
    }

    writeFileSync(outputPath, finalContent, 'utf-8');
    logger.success(
      `${adapter.name} → ${path.relative(process.cwd(), outputPath)}`,
    );
  }
}

/**
 * Sync gate-wrapper.ts from dist/ to .paw/ for TypeScript gate subprocess execution.
 * When bundled, PAW_CORE_DIR already points to dist/, so gate-wrapper.ts is directly accessible.
 *
 * @returns {boolean} True when all gate-wrapper files were found and copied
 */
function syncGateWrapper(): boolean {
  const files = ['gateWrapper.ts', 'gateContext.ts', 'healthCheckTypes.ts'];
  let success = true;

  for (const file of files) {
    const src = path.join(PAW_CORE_DIR, file);
    const dest = path.join(PAW_DIR, file);

    if (!existsSync(src)) {
      logger.warn(`${file} not found at ${src} — gates may fail`);
      success = false;
      continue;
    }

    copyFileSync(src, dest);
    logger.success(`${file} — copied`);
  }

  return success;
}

/**
 * Main sync entrypoint. Exported for use by CLI commands.
 */
export async function runPawSync(): Promise<void> {
  logger.pawIntro('PAW Sync');

  if (!existsSync(PAW_DIR)) {
    logger.error('.paw/ not found — run "npx paw init" first');
    process.exit(1);
  }

  const surface = readSurfaceConfig();
  const s = logger.spin();

  s.start('Syncing hooks');
  const copied = syncHooks();
  s.stop(`✅ Hooks synced (${copied} copied)`);

  s.start('Syncing gate wrapper');
  syncGateWrapper();
  s.stop('✅ Gate wrapper synced');

  s.start('Syncing runtime dependencies');
  syncRuntimeDeps();
  s.stop('✅ Runtime deps synced');

  s.start('Syncing Copilot assets (skills, agents, prompts)');
  const assetsCopied = syncAssets();
  s.stop(`✅ Copilot assets synced (${assetsCopied} copied)`);

  s.start(`Generating hook configs (surface: ${surface})`);
  generateSurfaceConfigs(surface);
  s.stop(`✅ Hook configs generated for ${surface}`);

  logger.pawOutro('Sync complete');
}

/**
 * True when this module is the direct entry point (invoked via `tsx pawSync.ts`
 * or the compiled `.mjs` form), false when imported by another module. Used
 * to guard the auto-run `runPawSync()` call below.
 */
const isDirectRun =
  process.argv[1]?.endsWith('pawSync.ts') ||
  process.argv[1]?.endsWith('pawSync.mjs');
if (isDirectRun) {
  runPawSync().catch((err: Error) => {
    logger.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
}
