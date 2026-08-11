/**
 * PAW Config Schema
 *
 * @fileoverview Host-agnostic config, not coupled to `.github` or Copilot. Repo
 * declares where PAW state lives, where gates are, which connector schema the host
 * uses, and where host reads and writes, as data. Enforcement loop identical across connectors.
 * `validateConfig` returns a ConfigProblem for each field that fails validation.
 *
 * @module @paw/core/domain/config
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ModelCapabilities } from './role.js';

/**
 * Repo's PAW config.
 *
 * @interface PawConfig
 * @property {string} root - Directory PAW's installed state live in (gitignored). Any location.
 * @property {string} gatesDir - Directory where quality gates get discovered from.
 * @property {string} connector - Name of host connector repo use (e.g. `copilot-hooks`, `copilot-sdk`, `vscode`).
 * @property {Record<string, string>} [hostPaths] - Where connector read/write host files (e.g. hooks.json target), keyed by connector-defined name.
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
 * Repo's `.paw/config.json` as parsed. Registry slice typed, every other field
 * passed through.
 *
 * @interface ConfigDocument
 * @property {Readonly<Record<string, ModelCapabilities>>} [models] - Declared models by id.
 * @property {Readonly<Record<string, string>>} [roles] - Role id → model id bindings.
 */
export interface ConfigDocument {
  readonly models?: Readonly<Record<string, ModelCapabilities>>;
  readonly roles?: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

/**
 * One configuration problem.
 *
 * @interface ConfigProblem
 * @property {string} field - The offending field.
 * @property {string} message - What wrong.
 */
export interface ConfigProblem {
  readonly field: string;
  readonly message: string;
}

/**
 * Whether value be non-empty string.
 *
 * @param {unknown} v - The value.
 * @returns {boolean} True when it non-empty string.
 */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Validate candidate config, return every problem found. Unresolvable connector
 * or missing required path be problem.
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
