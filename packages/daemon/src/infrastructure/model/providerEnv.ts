/**
 * PAW Provider Env
 *
 * @fileoverview Pure half of scoped provider credentials: each provider is one
 * dotenv file at `.paw/<name>.provider.env` in the consumer repo, name taken
 * from the filename. Inside, bare keys — `KEY`, `BASE_URL`, `TYPE`, `MODEL` —
 * no provider prefix. This module parses one file and picks the provider a run
 * uses; the filesystem walk and `process.env` read live in the excluded
 * live-herd shell.
 *
 * @module @paw/daemon/model/providerEnv
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ProviderBlock } from './sdkSessionRun.js';

/**
 * One provider, resolved from its env file.
 *
 * @interface ProviderProfile
 * @property {string} name - Provider name, from the filename.
 * @property {'openai' | 'azure' | 'anthropic'} type - Wire format; `TYPE` line, default `openai`.
 * @property {string} baseUrl - Endpoint; `BASE_URL` line.
 * @property {string} [model] - Default model id; `MODEL` line.
 * @property {string} key - Credential; `KEY` line. Read at egress, never logged.
 */
export interface ProviderProfile {
  readonly name: string;
  readonly type: ProviderBlock['type'];
  readonly baseUrl: string;
  readonly model?: string;
  readonly key: string;
}

const ENV_LINE = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/;
const WIRE_TYPES = ['openai', 'azure', 'anthropic'] as const;

/**
 * The provider name a `<name>.provider.env` filename carries, or null for any
 * other filename.
 *
 * @param {string} filename - Base filename.
 * @returns {string | null} Provider name.
 */
export function providerNameOf(filename: string): string | null {
  const match = /^([a-z0-9-]+)\.provider\.env$/.exec(filename);
  return match === null ? null : match[1];
}

/**
 * Parse one provider env file. `KEY` and `BASE_URL` are required; a file
 * missing either throws, naming the file — a half-configured provider must not
 * silently vanish from the roster. `TYPE` outside the wire formats throws too.
 *
 * @param {string} name - Provider name, from the filename.
 * @param {string} text - File contents.
 * @returns {ProviderProfile} The profile.
 */
export function parseProviderEnv(name: string, text: string): ProviderProfile {
  const vars: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) {
      continue;
    }
    const match = ENV_LINE.exec(line);
    if (match) {
      vars[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
  const key = vars.KEY ?? '';
  const baseUrl = vars.BASE_URL ?? '';
  if (key === '' || baseUrl === '') {
    throw new Error(`provider "${name}": ${name}.provider.env needs KEY and BASE_URL`);
  }
  const type = vars.TYPE ?? 'openai';
  if (!(WIRE_TYPES as readonly string[]).includes(type)) {
    throw new Error(
      `provider "${name}": TYPE "${type}" is not one of ${WIRE_TYPES.join(', ')}`,
    );
  }
  return {
    name,
    type: type as ProviderBlock['type'],
    baseUrl,
    ...(vars.MODEL === undefined || vars.MODEL === '' ? {} : { model: vars.MODEL }),
    key,
  };
}

/**
 * Pick the provider a run uses. A requested name must exist; with no request,
 * a single configured provider wins, then one named `deepseek`. Anything else
 * throws, listing what is configured.
 *
 * @param {ReadonlyMap<string, ProviderProfile>} providers - Configured providers, by name.
 * @param {string | undefined} requested - `PAW_PROVIDER`, when set.
 * @returns {ProviderProfile} The chosen provider.
 */
export function chooseProvider(
  providers: ReadonlyMap<string, ProviderProfile>,
  requested: string | undefined,
): ProviderProfile {
  if (requested !== undefined && requested !== '') {
    const hit = providers.get(requested);
    if (hit === undefined) {
      throw new Error(
        `provider "${requested}" has no .paw/${requested}.provider.env; configured: ${
          [...providers.keys()].join(', ') || '(none)'
        }`,
      );
    }
    return hit;
  }
  if (providers.size === 1) {
    return [...providers.values()][0];
  }
  const deepseek = providers.get('deepseek');
  if (deepseek !== undefined) {
    return deepseek;
  }
  throw new Error(
    `set PAW_PROVIDER to pick one of: ${[...providers.keys()].join(', ') || '(none configured)'}`,
  );
}
