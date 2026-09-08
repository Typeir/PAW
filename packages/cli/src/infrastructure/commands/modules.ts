/**
 * PAW CLI — modules command
 *
 * @fileoverview `paw modules [enable|disable <id>]`: list the module catalogue
 * with each entry's enabled state and whether its package resolves, or edit
 * that state in `.paw/config.json`. A module an enabled connector requires is
 * refused.
 *
 * @module @paw/cli/infrastructure/commands/modules
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { resolve } from 'node:path';
import { createNodeConfigDocument, createNodeModuleResolver } from '@paw/adapters';
import { disableModule, enableModule, resolveModules } from '@paw/core';
import { parseArgs } from '../../domain/context.js';
import { formatModules } from '../../domain/format.js';

/**
 * Run `modules` subcommand.
 *
 * @param {string[]} rest - Words after `modules`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} Exit code: 0 when listed or edited, 1 when refused.
 */
export async function runModules(
  rest: string[],
  print: (lines: string[]) => void,
): Promise<number> {
  const args = parseArgs(rest, ['root']);
  const [sub, id] = args.positional;
  const root = resolve(args.values.get('root') ?? '.');
  const document = createNodeConfigDocument(root);
  const resolver = createNodeModuleResolver(root);
  const config = await document.read();

  if (sub === undefined) {
    print(formatModules(await resolveModules(config, resolver)));
    return 0;
  }
  if (sub !== 'enable' && sub !== 'disable') {
    throw new Error(`unknown modules subcommand "${sub}": paw modules [enable|disable <id>]`);
  }
  if (id === undefined) {
    throw new Error(`paw modules ${sub} needs a module id`);
  }

  const edit = sub === 'enable' ? enableModule(config, id) : disableModule(config, id);
  if (!edit.ok) {
    print([`modules: ${edit.reason}`]);
    return 1;
  }
  await document.write(edit.config);
  print([
    `modules: ${id} ${sub}d`,
    ...formatModules(await resolveModules(edit.config, resolver)),
  ]);
  return 0;
}
