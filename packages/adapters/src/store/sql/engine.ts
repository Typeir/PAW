/**
 * PAW Store Engine Choice
 *
 * @fileoverview Select which SQL engine backs the store on this machine. The
 * choice is machine-level: some managed laptops block the native SQLite
 * binding, making `node:sqlite` unavailable there regardless of repo. Read
 * from `PAW_HOME` config, plus an env override. Runs outside the database it
 * selects.
 *
 * Pure function: takes config text as input, returns the resolved engine.
 *
 * @module @paw/adapters/store/sql/engine
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Engines PAW can back store with.
 *
 * `sqlite` native `node:sqlite` binding: file locking, incremental writes,
 * bundleable, no dependency. `wasm` sql.js: work where native binding blocked,
 * rewrite whole database file on every mutation.
 */
export type StoreEngine = 'sqlite' | 'wasm';

/**
 * Every valid engine name. For validation and error messages.
 */
export const STORE_ENGINES: readonly StoreEngine[] = ['sqlite', 'wasm'];

/**
 * Engine used when nothing configured.
 */
export const DEFAULT_STORE_ENGINE: StoreEngine = 'sqlite';

/**
 * Key machine config store engine under.
 */
export const ENGINE_CONFIG_KEY = 'db';

/**
 * Environment slice resolver read.
 *
 * @interface EngineEnv
 * @property {string} [PAW_DB_ENGINE] - One-off override. Takes precedence over the config file.
 */
export interface EngineEnv {
  readonly PAW_DB_ENGINE?: string;
}

/**
 * Narrow candidate to known engine, else throw naming valid choices.
 *
 * @param {string} value - Candidate engine name.
 * @param {string} source - Where it come from. For error message.
 * @returns {StoreEngine} Validated engine.
 * @throws {Error} When value not known engine.
 */
function validate(value: string, source: string): StoreEngine {
  const match = STORE_ENGINES.find((engine) => engine === value);
  if (match === undefined) {
    throw new Error(
      `${source} is "${value}", which is not a PAW store engine. Valid engines: ${STORE_ENGINES.join(', ')}.`,
    );
  }
  return match;
}

/**
 * Parse machine config text into object. Throws on malformed input.
 *
 * @param {string | null} configText - Config file contents, or null when absent.
 * @returns {Record<string, unknown>} Parsed config, empty when absent.
 * @throws {Error} When text not JSON, or not JSON object.
 */
function parseConfig(configText: string | null): Record<string, unknown> {
  if (configText === null || configText.trim() === '') {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(configText);
  } catch (err: unknown) {
    throw new Error(`PAW machine config is not valid JSON: ${String(err)}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('PAW machine config must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Select which engine backs the store.
 *
 * @param {EngineEnv} env - The environment. For one-off override.
 * @param {string | null} configText - Machine config file contents, or null when absent.
 * @returns {StoreEngine} Engine to open.
 * @throws {Error} When either source name engine PAW no have.
 */
export function resolveStoreEngine(
  env: EngineEnv,
  configText: string | null,
): StoreEngine {
  const override = env.PAW_DB_ENGINE;
  if (override !== undefined && override !== '') {
    return validate(override, 'PAW_DB_ENGINE');
  }

  const configured = parseConfig(configText)[ENGINE_CONFIG_KEY];
  if (configured === undefined) {
    return DEFAULT_STORE_ENGINE;
  }
  return validate(String(configured), `PAW machine config "${ENGINE_CONFIG_KEY}"`);
}

/**
 * Write engine choice into machine config. Keep every other key.
 *
 * @param {StoreEngine} engine - Engine to record.
 * @param {string | null} configText - Existing config contents, or null when absent.
 * @returns {string} Config text to write back.
 * @throws {Error} When existing config malformed.
 */
export function serialiseEngineChoice(
  engine: StoreEngine,
  configText: string | null,
): string {
  const config = parseConfig(configText);
  return `${JSON.stringify({ ...config, [ENGINE_CONFIG_KEY]: engine }, null, 2)}\n`;
}
