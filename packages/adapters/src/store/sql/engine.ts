/**
 * PAW Store Engine Choice
 *
 * @fileoverview Which SQL engine backs the store on this machine. The choice is
 * machine-level rather than per-repository because it answers a question about
 * the host, not about a project: some managed laptops block the native SQLite
 * binding, and on those `node:sqlite` is unavailable no matter which repository
 * is open. So it is resolved from `PAW_HOME`'s config, with an environment
 * override for a one-off run, and it lives outside the database it selects —
 * a value stored in the store cannot tell you how to open the store.
 *
 * Pure over injected text: the caller reads the config file, this decides.
 *
 * @module @paw/adapters/store/sql/engine
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * The engines PAW can back its store with.
 *
 * `sqlite` is the native `node:sqlite` binding — real locking, incremental
 * writes, and bundleable with no dependency. `wasm` is sql.js, which works
 * where the native binding is blocked at the cost of rewriting the whole
 * database file on every mutation.
 */
export type StoreEngine = 'sqlite' | 'wasm';

/**
 * Every valid engine name, for validation and for error messages that tell the
 * operator what they could have said instead.
 */
export const STORE_ENGINES: readonly StoreEngine[] = ['sqlite', 'wasm'];

/**
 * The engine used when nothing is configured.
 */
export const DEFAULT_STORE_ENGINE: StoreEngine = 'sqlite';

/**
 * The key the machine config stores the engine under.
 */
export const ENGINE_CONFIG_KEY = 'db';

/**
 * The environment slice the resolver reads.
 *
 * @interface EngineEnv
 * @property {string} [PAW_DB_ENGINE] - A one-off override; beats the config file.
 */
export interface EngineEnv {
  readonly PAW_DB_ENGINE?: string;
}

/**
 * Narrow a candidate to a known engine, or throw naming the valid choices.
 *
 * @param {string} value - The candidate engine name.
 * @param {string} source - Where it came from, for the error message.
 * @returns {StoreEngine} The validated engine.
 * @throws {Error} When the value is not a known engine.
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
 * Parse machine config text into an object, failing loudly on malformed input
 * so a typo in the config is reported rather than silently reverting the
 * operator to a default they did not choose.
 *
 * @param {string | null} configText - The config file's contents, or null when absent.
 * @returns {Record<string, unknown>} The parsed config, empty when absent.
 * @throws {Error} When the text is not JSON, or is not a JSON object.
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
 * Decide which engine backs the store.
 *
 * @param {EngineEnv} env - The environment, for a one-off override.
 * @param {string | null} configText - The machine config file's contents, or null when absent.
 * @returns {StoreEngine} The engine to open.
 * @throws {Error} When either source names an engine PAW does not have.
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
 * Write an engine choice into machine config, preserving every other key so
 * `paw config db` does not discard settings it does not own.
 *
 * @param {StoreEngine} engine - The engine to record.
 * @param {string | null} configText - The existing config contents, or null when absent.
 * @returns {string} The config text to write back.
 * @throws {Error} When the existing config is malformed, rather than clobbering it.
 */
export function serialiseEngineChoice(
  engine: StoreEngine,
  configText: string | null,
): string {
  const config = parseConfig(configText);
  return `${JSON.stringify({ ...config, [ENGINE_CONFIG_KEY]: engine }, null, 2)}\n`;
}
