/**
 * @fileoverview Self-contained CLI loader for the PAW CLI.
 *
 * PAW is designed to be portable (installable in external repos via
 * node_modules), so it carries its own loader rather than depending on
 * the project-level `scripts/utils/cli-loader.ts`.
 *
 * @module .github/PAW/cli/cli-loader
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Metadata describing a CLI command for discovery and help text.
 *
 * @interface CommandMeta
 * @property {string} name - Primary command name (matches filename sans extension)
 * @property {string} description - One-line description for help output
 * @property {Array<string>} [aliases] - Alternative names that route to this command
 * @property {Record<string, SubcommandDef>} [subcommands] - Nested subcommands
 */
export interface CommandMeta {
  name: string;
  description: string;
  aliases?: string[];
  subcommands?: Record<string, SubcommandDef>;
}

/**
 * A nested subcommand within a parent command.
 *
 * @interface SubcommandDef
 * @property {string} description - One-line description
 * @property {Array<string>} [aliases] - Alternative names
 * @property {boolean} [isDefault] - Run when parent is invoked without a subcommand
 */
export interface SubcommandDef {
  description: string;
  aliases?: string[];
  isDefault?: boolean;
}

/**
 * The contract every command file must satisfy.
 *
 * @interface CliCommand
 * @property {CommandMeta} meta - Command metadata for discovery
 * @property {Function} run - Handler invoked when the command is matched
 */
export interface CliCommand {
  meta: CommandMeta;
  run: (args: string[]) => void | Promise<void>;
}

/**
 * Loaded command registry keyed by primary name and aliases.
 *
 * @interface CommandRegistry
 * @property {Map<string, CliCommand>} commands - Name/alias to command lookup
 * @property {Array<CliCommand>} all - All loaded commands in discovery order
 */
export interface CommandRegistry {
  commands: Map<string, CliCommand>;
  all: CliCommand[];
}

/**
 * Load all command modules from a directory.
 *
 * @param commandsDir - Absolute path to the commands/ directory
 * @returns Registry of loaded commands
 */
export async function loadCommands(
  commandsDir: string,
): Promise<CommandRegistry> {
  const files = readdirSync(commandsDir).filter(
    (f) => f.endsWith('.ts') && f !== 'index.ts',
  );

  const registry: CommandRegistry = {
    commands: new Map(),
    all: [],
  };

  for (const file of files) {
    const fullPath = join(commandsDir, file);
    const mod = (await import(pathToFileURL(fullPath).href)) as CliCommand;

    if (!mod.meta || typeof mod.run !== 'function') continue;

    registry.all.push(mod);
    registry.commands.set(mod.meta.name, mod);

    if (mod.meta.aliases) {
      for (const alias of mod.meta.aliases) {
        registry.commands.set(alias, mod);
      }
    }
  }

  return registry;
}

/**
 * Resolve a subcommand within a parent command's meta.
 *
 * @param meta - Parent command meta
 * @param sub - Subcommand name from argv (may be undefined)
 * @returns Canonical subcommand key or null
 */
export function resolveSubcommand(
  meta: CommandMeta,
  sub: string | undefined,
): string | null {
  if (!meta.subcommands) return null;

  if (sub) {
    if (meta.subcommands[sub]) return sub;

    for (const [key, def] of Object.entries(meta.subcommands)) {
      if (def.aliases?.includes(sub)) return key;
    }
    return null;
  }

  for (const [key, def] of Object.entries(meta.subcommands)) {
    if (def.isDefault) return key;
  }

  return null;
}

/**
 * Resolve the commands directory relative to the calling module.
 * Works whether the package is in the project tree or node_modules.
 *
 * @param importMetaUrl - The calling module's `import.meta.url`
 * @param relPath - Relative path from the calling module to commands/
 * @returns Absolute path to the commands directory
 */
export function resolveCommandsDir(
  importMetaUrl: string,
  relPath: string = 'commands',
): string {
  return join(dirname(fileURLToPath(importMetaUrl)), relPath);
}
