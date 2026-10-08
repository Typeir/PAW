/**
 * PAW CLI — tasks command
 *
 * @fileoverview `paw tasks [<id>] [--related]`: list the repository's work
 * graph, render one task, or render one task with everything connected to it.
 * Needs the `paw-agile` module enabled in `.paw/config.json` and installed; a
 * module that is off, one that is not installed, and an unknown id are each
 * refused with the verb that fixes them.
 *
 * @module @paw/cli/infrastructure/commands/tasks
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { resolve } from 'node:path';
import { AGILE_MODULE, ROLLUP_FIELD, openRepoWorkModel } from '@paw/adapters';
import { parseArgs } from '../../domain/context.js';
import { formatTaskDetail, formatTasks } from '../../domain/format.js';

/**
 * Run `tasks` subcommand.
 *
 * @param {string[]} rest - Words after `tasks`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} Exit code: 0 when rendered, 1 when refused.
 */
export async function runTasks(rest: string[], print: (lines: string[]) => void): Promise<number> {
  const args = parseArgs(rest, ['root']);
  const [id] = args.positional;
  const root = resolve(args.values.get('root') ?? '.');
  const { enabled, installed, model, document, detail: reason } = await openRepoWorkModel(root);

  if (!enabled) {
    print([
      `tasks: the ${AGILE_MODULE} module is not enabled; enable it with paw modules enable ${AGILE_MODULE}`,
    ]);
    return 1;
  }
  if (model === null || !installed) {
    print([
      `tasks: the ${AGILE_MODULE} module is enabled but not installed (${reason}); install it with paw modules install ${AGILE_MODULE}`,
    ]);
    return 1;
  }

  if (id === undefined) {
    const view = model.view(document, ROLLUP_FIELD);
    print(formatTasks(view.rows, view.refusals, view.loops, view.dangling));
    return 0;
  }

  const detail = model.detail(document, id, ROLLUP_FIELD);
  if (detail === null) {
    print([`tasks: no task "${id}" in this repository; paw tasks lists every one`]);
    return 1;
  }
  print(formatTaskDetail(detail, args.flags.has('related')));
  return 0;
}
