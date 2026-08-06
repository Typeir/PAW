/**
 * PAW Configuration Schema
 *
 * @fileoverview The host-agnostic config that unbolts PAW from `.github` and
 * from Copilot. A repo declares where PAW lives, where its gates are, which
 * connector schema its host speaks, and where that host reads and writes — as
 * data, not as hardcoded paths and event names. Point PAW at your stuff and name
 * your connector; the enforcement loop is identical regardless. `validateConfig`
 * fails loud on a config that would silently misbehave.
 *
 * @module @paw/core/domain/config
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * A repo's PAW configuration.
 *
 * @interface PawConfig
 * @property {string} root - Directory PAW's installed state lives in (gitignored). Anywhere; not necessarily `.github`.
 * @property {string} gatesDir - Directory quality gates are discovered from.
 * @property {string} connector - Name of the host connector this repo uses (e.g. `copilot-hooks`, `copilot-sdk`, `vscode`).
 * @property {Record<string, string>} [hostPaths] - Where the connector reads/writes host files (e.g. a hooks.json target), keyed by a connector-defined name.
 * @property {readonly string[]} [exemptTools] - Read-only tools never blocked by violations.
 * @property {readonly string[]} [sourceDirectories] - Directories gates scan by default.
 */
export interface PawConfig {
  readonly root: string;
  readonly gatesDir: string;
  readonly connector: string;
  readonly hostPaths?: Readonly<Record<string, string>>;
  readonly exemptTools?: readonly string[];
  readonly sourceDirectories?: readonly string[];
}

/**
 * A single configuration problem.
 *
 * @interface ConfigProblem
 * @property {string} field - The offending field.
 * @property {string} message - What is wrong.
 */
export interface ConfigProblem {
  readonly field: string;
  readonly message: string;
}

/**
 * Whether a value is a non-empty string.
 *
 * @param {unknown} v - The value.
 * @returns {boolean} True when it is a non-empty string.
 */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Validate a candidate config, returning every problem found. A connector this
 * repo cannot resolve, or a missing required path, is a problem — surfaced, not
 * swallowed, so a misconfigured PAW refuses to run rather than enforcing nothing
 * silently.
 *
 * @param {unknown} candidate - The parsed config object.
 * @param {readonly string[]} knownConnectors - Connector names PAW can resolve.
 * @returns {ConfigProblem[]} One entry per problem; empty when valid.
 */
export function validateConfig(
  candidate: unknown,
  knownConnectors: readonly string[],
): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  if (typeof candidate !== 'object' || candidate === null) {
    return [{ field: '(root)', message: 'config must be an object' }];
  }
  const c = candidate as Record<string, unknown>;

  if (!isNonEmptyString(c.root)) {
    problems.push({ field: 'root', message: 'root must be a non-empty string' });
  }
  if (!isNonEmptyString(c.gatesDir)) {
    problems.push({ field: 'gatesDir', message: 'gatesDir must be a non-empty string' });
  }
  if (!isNonEmptyString(c.connector)) {
    problems.push({ field: 'connector', message: 'connector must be a non-empty string' });
  } else if (!knownConnectors.includes(c.connector)) {
    problems.push({
      field: 'connector',
      message: `unknown connector "${c.connector}"; known: ${knownConnectors.join(', ')}`,
    });
  }
  return problems;
}
