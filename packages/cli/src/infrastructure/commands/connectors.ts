/**
 * PAW CLI — connectors command
 *
 * @fileoverview `paw connectors [enable|disable <id>]`: list the connector
 * catalogue with each entry's enabled state, or edit that state in
 * `.paw/config.json`. Enabled linter connectors are read per hook run, so a
 * change here takes effect on the next edit without restarting pawd.
 *
 * @module @paw/cli/infrastructure/commands/connectors
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { resolve } from 'node:path';
import { createNodeConfigDocument } from '@paw/adapters';
import { connectorRoster, disableConnector, enableConnector } from '@paw/core';
import { parseArgs } from '../../domain/context.js';
import { formatConnectors } from '../../domain/format.js';

/**
 * Run `connectors` subcommand.
 *
 * @param {string[]} rest - Words after `connectors`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} Exit code: 0 when listed or edited, 1 when refused.
 */
export async function runConnectors(
  rest: string[],
  print: (lines: string[]) => void,
): Promise<number> {
  const args = parseArgs(rest, ['root']);
  const [sub, id] = args.positional;
  const document = createNodeConfigDocument(resolve(args.values.get('root') ?? '.'));
  const config = await document.read();

  if (sub === undefined) {
    print(formatConnectors(connectorRoster(config)));
    return 0;
  }
  if (sub !== 'enable' && sub !== 'disable') {
    throw new Error(
      `unknown connectors subcommand "${sub}": paw connectors [enable|disable <id>]`,
    );
  }
  if (id === undefined) {
    throw new Error(`paw connectors ${sub} needs a connector id`);
  }

  const edit = sub === 'enable' ? enableConnector(config, id) : disableConnector(config, id);
  if (!edit.ok) {
    print([`connectors: ${edit.reason}`]);
    return 1;
  }
  await document.write(edit.config);
  print([`connectors: ${id} ${sub}d`, ...formatConnectors(connectorRoster(edit.config))]);
  return 0;
}
