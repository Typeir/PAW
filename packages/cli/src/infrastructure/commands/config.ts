/**
 * PAW CLI — config command
 *
 * @fileoverview `paw config` edit repo model bindings on disk: show roles and bindings, bind role to declared model, unbind, or declare model. CLI hold filesystem authority; write `.paw/config.json` through core edit engine, same engine console reach over control API.
 *
 * @module @paw/cli/infrastructure/commands/config
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  BUILTIN_ROLES,
  clearBinding,
  declareModel,
  parseCapabilities,
  setBinding,
  type ConfigDocument,
  type ConfigEdit,
} from '@paw/core';
import { createNodeConfigDocument } from '@paw/adapters';
import type { ConfigDocumentPort } from '@paw/core';
import { parseArgs } from '../../domain/context.js';

/**
 * Print declared models and each role binding.
 *
 * @param {ConfigDocument} config - Current document.
 * @param {(lines: string[]) => void} print - Line printer.
 */
function showConfig(config: ConfigDocument, print: (lines: string[]) => void): void {
  const models = Object.keys(config.models ?? {});
  print([
    `models: ${models.length === 0 ? '(none declared)' : models.join(', ')}`,
    '',
    ...BUILTIN_ROLES.map((role) => {
      const bound = config.roles?.[role.id];
      const optional = role.optional ? ' [optional]' : '';
      return `${bound ? '✓' : '·'} ${role.id} → ${bound ?? '(unbound)'}${optional}`;
    }),
  ]);
}

/**
 * Write edit, or report why refused.
 *
 * @param {ConfigEdit} edit - Edit outcome.
 * @param {ConfigDocumentPort} doc - Document to write.
 * @param {(lines: string[]) => void} print - Line printer.
 * @param {string} done - Line to print on success.
 * @returns {Promise<number>} 0 on success, 1 on refusal.
 */
async function commit(
  edit: ConfigEdit,
  doc: ConfigDocumentPort,
  print: (lines: string[]) => void,
  done: string,
): Promise<number> {
  if (!edit.ok) {
    print([edit.reason]);
    return 1;
  }
  await doc.write(edit.config);
  print([done]);
  return 0;
}

/**
 * Run `config` subcommand.
 *
 * @param {string[]} rest - Words after `config`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} Exit code.
 */
export async function runConfig(
  rest: string[],
  print: (lines: string[]) => void,
): Promise<number> {
  const sub = rest[0];
  const doc = createNodeConfigDocument(process.cwd());
  const config = await doc.read();

  if (sub === undefined || sub === 'show') {
    showConfig(config, print);
    return 0;
  }
  if (sub === 'bind') {
    const [, role, model] = rest;
    if (role === undefined || model === undefined) {
      throw new Error('usage: paw config bind <role> <model>');
    }
    return commit(setBinding(config, role, model), doc, print, `bound ${role} → ${model}`);
  }
  if (sub === 'unbind') {
    const role = rest[1];
    if (role === undefined) {
      throw new Error('usage: paw config unbind <role>');
    }
    return commit(clearBinding(config, role), doc, print, `unbound ${role}`);
  }
  if (sub === 'model') {
    const args = parseArgs(rest.slice(1), ['context', 'max-output', 'cost']);
    const id = args.positional[0];
    if (id === undefined) {
      throw new Error(
        'usage: paw config model <id> --context N --max-output N --cost <tier> [--tools --structured --reasoning --vision]',
      );
    }
    const parsed = parseCapabilities({
      contextTokens: Number(args.values.get('context')),
      maxOutputTokens: Number(args.values.get('max-output')),
      tools: args.flags.has('tools'),
      structuredOutput: args.flags.has('structured'),
      reasoning: args.flags.has('reasoning'),
      vision: args.flags.has('vision'),
      costClass: args.values.get('cost'),
    });
    if (!parsed.ok) {
      print([parsed.reason]);
      return 1;
    }
    return commit(declareModel(config, id, parsed.capabilities), doc, print, `declared model ${id}`);
  }
  throw new Error(`unknown config subcommand "${sub}" — try show, bind, unbind, or model`);
}
