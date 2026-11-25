/**
 * PAW Provider Setup
 *
 * @fileoverview Pure half of `paw providers`: plan the files that add a
 * provider, and the hints that name the `paw` verb for each step a live run
 * still lacks. Input is validated by writing the provider file and reading it
 * back through {@link parseProviderEnv}; the caller writes the planned files.
 *
 * @module @paw/daemon/model/providerSetup
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { pawIgnoreText } from '@paw/core';
import {
  addProviderCommand,
  declareModelCommand,
  parseProviderEnv,
  providerNameOf,
  type ProviderProfile,
} from './providerEnv.js';

/**
 * Provider fields as given to `paw providers add`.
 *
 * @interface ProviderInput
 * @property {string} name - Provider name; the file is `.paw/<name>.provider.env`.
 * @property {string | undefined} type - `--type`; `openai` when undefined.
 * @property {string | undefined} baseUrl - `--base-url`.
 * @property {string | undefined} model - `--model`.
 * @property {string} key - Credential from stdin or the prompt; surrounding whitespace trimmed.
 */
export interface ProviderInput {
  readonly name: string;
  readonly type: string | undefined;
  readonly baseUrl: string | undefined;
  readonly model: string | undefined;
  readonly key: string;
}

/**
 * One file an add writes, relative to the repository root.
 *
 * @interface ProviderWrite
 * @property {string} path - Path relative to the repository root, `/`-separated.
 * @property {string} content - File contents.
 * @property {boolean} private - True for the credential file; written owner-only where the OS supports it.
 */
export interface ProviderWrite {
  readonly path: string;
  readonly content: string;
  readonly private: boolean;
}

/**
 * Outcome of {@link planProviderAdd}: the profile and files, or the reason it is refused.
 */
export type ProviderAddPlan =
  | { readonly ok: true; readonly profile: ProviderProfile; readonly writes: readonly ProviderWrite[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Minimal provider row {@link providerHints} reads; `listProviders` rows satisfy it.
 *
 * @interface ProviderRow
 * @property {string} name - Provider name.
 * @property {string} [model] - Default model id, when the file names one.
 * @property {string} [error] - Parse failure, for a file that does not parse.
 */
export interface ProviderRow {
  readonly name: string;
  readonly model?: string;
  readonly error?: string;
}

const FIELDS = [
  ['TYPE', 'type'],
  ['BASE_URL', 'baseUrl'],
  ['MODEL', 'model'],
  ['KEY', 'key'],
] as const;

/**
 * Provider env file text for a profile; {@link parseProviderEnv} reads it back to the same profile.
 *
 * @param {ProviderProfile & { model: string }} profile - Profile to write; `name` names the file and is not written.
 * @returns {string} File text, one `NAME=value` line per field.
 */
export function formatProviderEnv(profile: ProviderProfile & { readonly model: string }): string {
  return FIELDS.map(([field, prop]) => `${field}=${profile[prop]}\n`).join('');
}

/**
 * Plan adding or replacing a provider: its env file and a `.paw/.gitignore` that covers it.
 *
 * @param {ProviderInput} input - Fields from the command line and the key.
 * @param {string} existingIgnore - Current `.paw/.gitignore` text; empty when absent.
 * @returns {ProviderAddPlan} Profile and files, or a refusal naming the field.
 */
export function planProviderAdd(input: ProviderInput, existingIgnore: string): ProviderAddPlan {
  const { name } = input;
  if (providerNameOf(`${name}.provider.env`) === null) {
    return { ok: false, reason: `provider name "${name}" must be lowercase letters, digits, and dashes` };
  }
  if (input.baseUrl === undefined || input.baseUrl === '') {
    return { ok: false, reason: `provider "${name}": --base-url is required` };
  }
  if (input.model === undefined || input.model === '') {
    return { ok: false, reason: `provider "${name}": --model is required` };
  }
  const key = input.key.trim();
  if (key === '') {
    return { ok: false, reason: `provider "${name}": no key given; pipe it on stdin or type it at the prompt` };
  }
  const wanted = {
    name,
    type: (input.type ?? 'openai') as ProviderProfile['type'],
    baseUrl: input.baseUrl,
    model: input.model,
    key,
  };
  const content = formatProviderEnv(wanted);
  let stored: ProviderProfile;
  try {
    stored = parseProviderEnv(name, content);
  } catch (err: unknown) {
    return { ok: false, reason: (err as Error).message };
  }
  const changed = FIELDS.find(([, prop]) => stored[prop] !== wanted[prop]);
  if (changed !== undefined) {
    return { ok: false, reason: `provider "${name}": ${changed[0]} holds a line break, quote, or surrounding space` };
  }
  return {
    ok: true,
    profile: stored,
    writes: [
      { path: `.paw/${name}.provider.env`, content, private: true },
      { path: '.paw/.gitignore', content: pawIgnoreText(existingIgnore), private: false },
    ],
  };
}

/**
 * Hint for one provider row, or null when the row is ready.
 *
 * @param {ProviderRow} row - Provider row.
 * @param {Readonly<Record<string, unknown>> | undefined} models - `models` from `.paw/config.json`.
 * @returns {string | null} The hint naming the verb that fixes the row.
 */
function rowHint(row: ProviderRow, models: Readonly<Record<string, unknown>> | undefined): string | null {
  if (row.error !== undefined) {
    return `provider "${row.name}" does not parse: ${addProviderCommand(row.name)}`;
  }
  if (row.model === undefined) {
    return `provider "${row.name}" names no model: ${addProviderCommand(row.name)}`;
  }
  if (models?.[row.model] === undefined) {
    return `declare model "${row.model}": ${declareModelCommand(row.model)}`;
  }
  return null;
}

/**
 * Steps a live run still lacks, each naming the `paw` verb that takes it.
 *
 * @param {readonly ProviderRow[]} roster - Configured providers.
 * @param {Readonly<Record<string, unknown>> | undefined} models - `models` from `.paw/config.json`.
 * @param {string | undefined} requested - `PAW_PROVIDER`; empty counts as unset.
 * @returns {string[]} Hints in roster order, then the provider pick; empty when a run can bind.
 */
export function providerHints(
  roster: readonly ProviderRow[],
  models: Readonly<Record<string, unknown>> | undefined,
  requested: string | undefined,
): string[] {
  if (roster.length === 0) {
    return [`add a provider: ${addProviderCommand()}   (key on stdin)`];
  }
  const hints = roster.map((row) => rowHint(row, models)).filter((hint) => hint !== null);
  const names = roster.map((row) => row.name);
  if (requested === undefined || requested === '') {
    if (roster.length > 1) {
      hints.push(`several providers: pick one per run with PAW_PROVIDER=<${names.join('|')}>`);
    }
  } else if (!names.includes(requested)) {
    hints.push(`PAW_PROVIDER="${requested}" names no configured provider; configured: ${names.join(', ')}`);
  }
  return hints;
}
