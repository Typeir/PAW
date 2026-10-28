/**
 * PAW OpenProject Backend Env
 *
 * @fileoverview Parses the consuming repository's `.paw/openproject.backend.env`: `BASE_URL`,
 * `KEY` (an API v3 access token), and `PROJECT` (identifier or numeric id). The file holds a
 * credential; PAW's secrets rule denies agent tools on it.
 *
 * @module @paw/openproject/domain/backendEnv
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Repository-relative path of the env file.
 *
 * @constant
 */
export const ENV_FILE = '.paw/openproject.backend.env';

/**
 * Keys the env file must set.
 *
 * @constant
 */
const REQUIRED = ['BASE_URL', 'KEY', 'PROJECT'] as const;

/**
 * Connection to one OpenProject project.
 *
 * @interface BackendConfig
 * @property {string} baseUrl - Instance origin, no trailing slash.
 * @property {string} key - API access token.
 * @property {string} project - Project identifier or numeric id; its subprojects are included.
 */
export interface BackendConfig {
  readonly baseUrl: string;
  readonly key: string;
  readonly project: string;
}

/**
 * Outcome of parsing the env file.
 */
export type BackendEnv =
  | { readonly ok: true; readonly config: BackendConfig }
  | { readonly ok: false; readonly reason: string };

/**
 * A value with one pair of matching surrounding quotes removed.
 *
 * @param {string} value - Trimmed value.
 * @returns {string} The unquoted value.
 */
function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted === null ? value : (quoted[2] as string);
}

/**
 * `KEY=value` pairs of an env file. Blank lines, `#` comments, and lines without `=` are skipped.
 *
 * @param {string} text - File text; LF or CRLF.
 * @returns {Map<string, string>} Values by key; a later line wins.
 */
function pairsOf(text: string): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (line.trimStart().startsWith('#') || at < 0) {
      continue;
    }
    pairs.set(line.slice(0, at).trim(), unquote(line.slice(at + 1).trim()));
  }
  return pairs;
}

/**
 * The backend connection the env file names.
 *
 * @param {string} text - Env file text.
 * @returns {BackendEnv} The config, or a refusal naming every missing key.
 */
export function parseBackendEnv(text: string): BackendEnv {
  const pairs = pairsOf(text);
  const missing = REQUIRED.filter((key) => (pairs.get(key) ?? '') === '');
  if (missing.length > 0) {
    return { ok: false, reason: `${ENV_FILE} needs ${missing.join(', ')}` };
  }
  return {
    ok: true,
    config: {
      baseUrl: (pairs.get('BASE_URL') as string).replace(/\/+$/, ''),
      key: pairs.get('KEY') as string,
      project: pairs.get('PROJECT') as string,
    },
  };
}
