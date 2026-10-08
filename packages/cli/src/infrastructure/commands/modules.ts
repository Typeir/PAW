/**
 * PAW CLI — modules command
 *
 * @fileoverview `paw modules [enable|disable|install|uninstall <id>]`: list the
 * module catalogue with each entry's enabled state and whether it is
 * installed, edit that state in `.paw/config.json`, clone a module into
 * `.paw/modules/<id>` at the ref the catalogue pins, or remove one already
 * there. `--from` overrides the clone source with a path or URL. A failed
 * install removes the directory it just made, so the next attempt is not
 * refused as already installed. A module an enabled connector requires is
 * refused; an enabled module refuses to uninstall until it is disabled.
 *
 * @module @paw/cli/infrastructure/commands/modules
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createNodeConfigDocument,
  createNodeModuleResolver,
  createNodeProcess,
} from '@paw/adapters';
import {
  MODULES_DIR,
  disableModule,
  enableModule,
  enabledModuleIds,
  planInstall,
  planUninstall,
  resolveModules,
  runInstall,
} from '@paw/core';
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
  const args = parseArgs(rest, ['root', 'from']);
  const [sub, id] = args.positional;
  const root = resolve(args.values.get('root') ?? '.');
  const document = createNodeConfigDocument(root);
  const resolver = createNodeModuleResolver(root);
  const config = await document.read();

  if (sub === undefined) {
    print(formatModules(await resolveModules(config, resolver)));
    return 0;
  }
  if (sub !== 'enable' && sub !== 'disable' && sub !== 'install' && sub !== 'uninstall') {
    throw new Error(
      `unknown modules subcommand "${sub}": paw modules [enable|disable|install|uninstall <id>]`,
    );
  }
  if (id === undefined) {
    throw new Error(`paw modules ${sub} needs a module id`);
  }

  if (sub === 'install') {
    const plan = planInstall(id, args.values.get('from'), existsSync(join(root, MODULES_DIR, id)));
    if (!plan.ok) {
      print([`modules: ${plan.reason}`]);
      return 1;
    }
    print([`modules: cloning ${plan.source} into ${plan.target} at ${plan.ref}`]);
    const outcome = await runInstall(createNodeProcess(), root, plan);
    if (!outcome.ok) {
      rmSync(join(root, plan.target), { recursive: true, force: true });
      print([`modules: ${outcome.reason}`]);
      return 1;
    }
    print([
      `modules: ${id} installed — ${outcome.detail}`,
      ...formatModules(await resolveModules(config, resolver)),
    ]);
    return 0;
  }

  if (sub === 'uninstall') {
    const plan = planUninstall(
      id,
      enabledModuleIds(config).includes(id),
      existsSync(join(root, MODULES_DIR, id)),
    );
    if (!plan.ok) {
      print([`modules: ${plan.reason}`]);
      return 1;
    }
    rmSync(join(root, plan.target), { recursive: true, force: true });
    print([
      `modules: ${id} uninstalled — removed ${plan.target}`,
      ...formatModules(await resolveModules(config, resolver)),
    ]);
    return 0;
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
