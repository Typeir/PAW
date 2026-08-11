/**
 * PAW Init Config
 *
 * @fileoverview Decide what happen when PAW attach to repo already have
 * config. One rule out: no unconditional overwrite. `.paw/config.json`
 * repo-authored and tracked, silent replacement destroy work no backup covers.
 *
 * PAW stamps config with version and content hash. Later `init` classify into
 * three cases — nothing there, config PAW wrote, config PAW not write — and
 * report which it finds.
 *
 * Result returned as data. Each consumer acts on it: CLI raises error and
 * offers `--merge` / `--override`, TUI offers same two as choices, console
 * raises dialog. All call same resolveInit; difference only in presentation.
 *
 * @module @paw/core/domain/initConfig
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Hash string to sixty-four bits, hex.
 *
 * Two FNV-1a lanes with different offsets, not SHA-256. Core compiles into
 * browser bundle via `@paw/gui`, so cannot import `node:crypto`. Hash
 * detects whether file changed since PAW wrote it; detects accidental edits,
 * not adversarial tampering. Config failing check refused. Collision costs
 * an extra prompt, never a silent overwrite.
 *
 * @param {string} text - The text to hash.
 * @returns {string} Sixteen lowercase hex characters.
 */
function hash64(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + i), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * Config schema version PAW writes today. Stamped into every config so later
 * runs know which schema version to read.
 */
export const PAW_CONFIG_VERSION = '5.0.0';

/**
 * Key PAW own metadata occupy. Namespaced so it no collide with key repo declare.
 */
export const PAW_STAMP_KEY = '$paw';

/**
 * PAW marker inside config it wrote.
 *
 * @interface PawStamp
 * @property {string} version - Config schema version written.
 * @property {string} hash - Content hash of config as written, exclude stamp.
 */
export interface PawStamp {
  readonly version: string;
  readonly hash: string;
}

/**
 * What `init` find where config go.
 *
 * @property absent - No config, or empty one.
 * @property unstamped - Config exist, PAW not write.
 * @property stamped - Config PAW write, and whether changed since.
 */
export type InitConflict =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unstamped' }
  | {
      readonly kind: 'stamped';
      readonly stamp: PawStamp;
      readonly edited: boolean;
    };

/**
 * How operator resolve conflict.
 *
 * `create` default, refuse when anything already there.
 */
export type InitMode = 'create' | 'merge' | 'override';

/**
 * What `init` should do about config.
 *
 * @property write - Write `content`.
 * @property refuse - Do nothing; `conflict` reports what was found, `reason` explains why.
 */
export type InitOutcome =
  | { readonly kind: 'write'; readonly content: string }
  | {
      readonly kind: 'refuse';
      readonly conflict: InitConflict;
      readonly reason: string;
    };

/**
 * Serialize object with keys in fixed sorted order; hash reflects content,
 * independent of key insertion order.
 *
 * @param {Record<string, unknown>} config - Config.
 * @returns {string} Canonical JSON.
 */
function canonical(config: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(config).sort()) {
    if (key !== PAW_STAMP_KEY) {
      ordered[key] = config[key];
    }
  }
  return JSON.stringify(ordered);
}

/**
 * Content hash of config, ignore PAW own stamp.
 *
 * @param {Record<string, unknown>} config - Config.
 * @returns {string} Twelve-character hex digest.
 */
export function hashConfig(config: Record<string, unknown>): string {
  return hash64(canonical(config)).slice(0, 12);
}

/**
 * Render config as file PAW write, stamp with version and hash.
 *
 * @param {Record<string, unknown>} config - Config to write.
 * @returns {string} File contents.
 */
export function stampConfig(config: Record<string, unknown>): string {
  const stamp: PawStamp = {
    version: PAW_CONFIG_VERSION,
    hash: hashConfig(config),
  };
  return `${JSON.stringify({ [PAW_STAMP_KEY]: stamp, ...config }, null, 2)}\n`;
}

/**
 * Parse config file; throws on present-but-unparseable text. Unparseable
 * config still exists on disk; treating it as absent could allow overwrite.
 *
 * @param {string} text - File contents.
 * @returns {Record<string, unknown>} Parsed config.
 * @throws {Error} Text not JSON object.
 */
function parse(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err: unknown) {
    throw new Error(`PAW config is not valid JSON: ${String(err)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('PAW config must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Read stamp out of parsed config, if it carry well-formed one.
 *
 * @param {Record<string, unknown>} config - Parsed config.
 * @returns {PawStamp | null} Stamp, or null when absent or malformed.
 */
function readStamp(config: Record<string, unknown>): PawStamp | null {
  const raw = config[PAW_STAMP_KEY];
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const { version, hash } = raw as Record<string, unknown>;
  return typeof version === 'string' && typeof hash === 'string'
    ? { version, hash }
    : null;
}

/**
 * Classify what already at config path.
 *
 * @param {string | null} text - Existing file contents, or null when absent.
 * @returns {InitConflict} What was found.
 * @throws {Error} Config present but unreadable.
 */
export function inspectConfig(text: string | null): InitConflict {
  if (text === null || text.trim() === '') {
    return { kind: 'absent' };
  }
  const config = parse(text);
  const stamp = readStamp(config);
  if (stamp === null) {
    return { kind: 'unstamped' };
  }
  return { kind: 'stamped', stamp, edited: hashConfig(config) !== stamp.hash };
}

/**
 * Combine existing config with keys PAW needs; existing value wins.
 *
 * Merge never removes or rewrites existing keys; PAW only fills in missing
 * keys. Drops old stamp so result gets re-stamped with fresh hash.
 *
 * @param {Record<string, unknown>} existing - Config already on disk.
 * @param {Record<string, unknown>} incoming - Keys PAW want present.
 * @returns {Record<string, unknown>} Merged config.
 */
export function mergeConfig(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...incoming, ...existing };
  delete merged[PAW_STAMP_KEY];
  return merged;
}

/**
 * Return refusal reason with actions operator can take (`--merge` / `--override`).
 *
 * @param {InitConflict} conflict - What was found.
 * @returns {string} Reason.
 */
function refusal(conflict: InitConflict): string {
  const detail =
    conflict.kind === 'stamped'
      ? `PAW wrote it (version ${conflict.stamp.version})${conflict.edited ? ' and it has been edited since' : ''}`
      : 'PAW did not write it';
  return `.paw/config.json already exists — ${detail}. Re-run with --merge to keep what is there and add what is missing, or --override to replace it.`;
}

/**
 * Decide what `init` do about config.
 *
 * @param {string | null} existingText - Existing file contents, or null when absent.
 * @param {Record<string, unknown>} incoming - Keys PAW want present.
 * @param {InitMode} mode - How operator resolve conflict.
 * @returns {InitOutcome} Decision.
 * @throws {Error} Config present but unreadable.
 */
export function resolveInit(
  existingText: string | null,
  incoming: Record<string, unknown>,
  mode: InitMode,
): InitOutcome {
  const conflict = inspectConfig(existingText);
  if (conflict.kind === 'absent' || mode === 'override') {
    return { kind: 'write', content: stampConfig(incoming) };
  }
  if (mode === 'merge') {
    return {
      kind: 'write',
      content: stampConfig(mergeConfig(parse(existingText as string), incoming)),
    };
  }
  return { kind: 'refuse', conflict, reason: refusal(conflict) };
}
