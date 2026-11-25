/**
 * PAW CLI — providers command
 *
 * @fileoverview `paw providers [list]` print the repository's model providers
 * key-free, then the steps a live run lacks. `paw providers add <name>
 * --base-url <url> --model <id> [--type <wire>]` write `.paw/<name>.provider.env`
 * and make `.paw/.gitignore` cover it; the key is read from piped stdin, or
 * from a hidden prompt on a terminal, and never from argv. `paw providers remove
 * <name>` delete the file. Rules come from `planProviderAdd` and
 * `providerHints`; this module reads input and writes their result.
 *
 * @module @paw/cli/infrastructure/commands/providers
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createNodeConfigDocument } from '@paw/adapters';
import { listProviders, planProviderAdd, providerHints } from '@paw/daemon';
import { parseArgs } from '../../domain/context.js';
import { formatProviders } from '../../domain/format.js';
import { readHidden, readStdin } from '../stdin.js';

const ADD_USAGE =
  'usage: paw providers add <name> --base-url <url> --model <id> [--type openai|azure|anthropic]';

/**
 * Print the roster and its hints for the repository at `root`.
 *
 * @param {string} root - Repository root.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<void>} Resolves once printed.
 */
async function showProviders(root: string, print: (lines: string[]) => void): Promise<void> {
  const roster = listProviders(root);
  const { models } = await createNodeConfigDocument(root).read();
  print(formatProviders(roster, providerHints(roster, models, process.env.PAW_PROVIDER)));
}

/**
 * The key: piped stdin, or a hidden prompt when stdin is a terminal.
 *
 * @returns {Promise<string>} Key text as read; the planner trims it.
 */
async function readKey(): Promise<string> {
  return process.stdin.isTTY === true ? readHidden('key: ') : readStdin();
}

/**
 * Text of a file, or empty when it does not exist.
 *
 * @param {string} path - File path.
 * @returns {string} Contents, or empty.
 */
function readOptional(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/**
 * Run `paw providers add`.
 *
 * @param {string} root - Repository root.
 * @param {string[]} argv - Words after `add`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} 0 when written, 1 when refused.
 * @throws {Error} When no provider name is given.
 */
async function addProvider(root: string, argv: string[], print: (lines: string[]) => void): Promise<number> {
  const args = parseArgs(argv, ['base-url', 'model', 'type']);
  const name = args.positional[0];
  if (name === undefined) {
    throw new Error(ADD_USAGE);
  }
  const plan = planProviderAdd(
    {
      name,
      type: args.values.get('type'),
      baseUrl: args.values.get('base-url'),
      model: args.values.get('model'),
      key: await readKey(),
    },
    readOptional(join(root, '.paw', '.gitignore')),
  );
  if (!plan.ok) {
    print([`providers: ${plan.reason}`]);
    return 1;
  }
  mkdirSync(join(root, '.paw'), { recursive: true });
  for (const write of plan.writes) {
    writeFileSync(join(root, write.path), write.content, write.private ? { mode: 0o600 } : {});
  }
  print([`providers: wrote .paw/${name}.provider.env · key ${plan.profile.key.length} chars`]);
  await showProviders(root, print);
  return 0;
}

/**
 * Run `paw providers remove`.
 *
 * @param {string} root - Repository root.
 * @param {string | undefined} name - Provider to remove.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} 0 when removed, 1 when no such provider is configured.
 * @throws {Error} When no provider name is given.
 */
async function removeProvider(
  root: string,
  name: string | undefined,
  print: (lines: string[]) => void,
): Promise<number> {
  if (name === undefined) {
    throw new Error('usage: paw providers remove <name>');
  }
  const file = join(root, '.paw', `${name}.provider.env`);
  if (!existsSync(file)) {
    print([`providers: provider "${name}" is not configured; list them with paw providers`]);
    return 1;
  }
  rmSync(file);
  print([`providers: removed .paw/${name}.provider.env`]);
  await showProviders(root, print);
  return 0;
}

/**
 * Run `providers` subcommand in the current directory.
 *
 * @param {string[]} rest - Words after `providers`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} 0 when ok, 1 when an add or remove is refused.
 * @throws {Error} On an unknown subcommand or missing name.
 */
export async function runProviders(rest: string[], print: (lines: string[]) => void): Promise<number> {
  const root = process.cwd();
  const sub = rest[0];
  if (sub === undefined || sub === 'list') {
    await showProviders(root, print);
    return 0;
  }
  if (sub === 'add') {
    return addProvider(root, rest.slice(1), print);
  }
  if (sub === 'remove') {
    return removeProvider(root, rest[1], print);
  }
  throw new Error(`unknown providers subcommand "${sub}" — try list, add, or remove`);
}
