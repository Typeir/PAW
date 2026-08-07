/**
 * PAW Init Config
 *
 * @fileoverview Deciding what happens when PAW is attached to a repo that
 * already has a config. Writing over it unconditionally is the one behaviour
 * ruled out: `.paw/config.json` is repo-authored and tracked, so a silent
 * replacement destroys work no backup covers.
 *
 * PAW stamps what it writes with a version and a content hash, which lets a
 * later `init` tell three situations apart — nothing there, a config PAW wrote,
 * and a config it did not — and say which one it found rather than guessing.
 *
 * The outcome is returned as data, not thrown and not printed, because every
 * consumer has to be able to act on it: the CLI turns a refusal into a loud
 * error and offers `--merge` / `--override`, a TUI offers the same two as a
 * choice, and the console raises a dialog. Same call, same answer, three
 * presentations — no surface re-derives the rule.
 *
 * @module @paw/core/domain/initConfig
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Hash a string to sixty-four bits, rendered as hex.
 *
 * Two FNV-1a lanes with different offsets rather than SHA-256, because core is
 * compiled into a browser bundle by `@paw/gui` and cannot import `node:crypto`.
 * That trade is safe here: this hash answers "has anyone edited the file since
 * PAW wrote it", a question about accident rather than malice. Nothing decides
 * trust on it, and a config that fails the check is refused rather than
 * accepted, so a collision costs a needless prompt and never a silent overwrite.
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
 * The config schema version PAW writes today. Stamped into every config so a
 * later run knows which shape it is looking at.
 */
export const PAW_CONFIG_VERSION = '5.0.0';

/**
 * The key PAW's own metadata occupies. Namespaced so it cannot collide with a
 * key the repo declares.
 */
export const PAW_STAMP_KEY = '$paw';

/**
 * PAW's marker inside a config it wrote.
 *
 * @interface PawStamp
 * @property {string} version - The config schema version written.
 * @property {string} hash - Content hash of the config as written, excluding the stamp.
 */
export interface PawStamp {
  readonly version: string;
  readonly hash: string;
}

/**
 * What `init` found where the config goes.
 *
 * @property absent - No config, or an empty one.
 * @property unstamped - A config exists that PAW did not write.
 * @property stamped - A config PAW wrote, with whether it changed since.
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
 * How the operator resolved a conflict.
 *
 * `create` is the default and refuses when anything is already there.
 */
export type InitMode = 'create' | 'merge' | 'override';

/**
 * What `init` should do about the config.
 *
 * @property write - Write `content`.
 * @property refuse - Do nothing; `conflict` says what was found and `reason` says it in words.
 */
export type InitOutcome =
  | { readonly kind: 'write'; readonly content: string }
  | {
      readonly kind: 'refuse';
      readonly conflict: InitConflict;
      readonly reason: string;
    };

/**
 * Serialise an object with its keys in a fixed order, so a hash describes the
 * content rather than the order a particular writer happened to emit.
 *
 * @param {Record<string, unknown>} config - The config.
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
 * Content hash of a config, ignoring PAW's own stamp.
 *
 * @param {Record<string, unknown>} config - The config.
 * @returns {string} A twelve-character hex digest.
 */
export function hashConfig(config: Record<string, unknown>): string {
  return hash64(canonical(config)).slice(0, 12);
}

/**
 * Render a config as the file PAW writes, stamped with its version and hash.
 *
 * @param {Record<string, unknown>} config - The config to write.
 * @returns {string} The file contents.
 */
export function stampConfig(config: Record<string, unknown>): string {
  const stamp: PawStamp = {
    version: PAW_CONFIG_VERSION,
    hash: hashConfig(config),
  };
  return `${JSON.stringify({ [PAW_STAMP_KEY]: stamp, ...config }, null, 2)}\n`;
}

/**
 * Parse a config file, failing loud on anything that is present but unreadable
 * — an unparseable config is a problem to report, and treating it as absent
 * would licence overwriting it.
 *
 * @param {string} text - The file contents.
 * @returns {Record<string, unknown>} The parsed config.
 * @throws {Error} When the text is not a JSON object.
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
 * Read a stamp out of a parsed config, if it carries a well-formed one.
 *
 * @param {Record<string, unknown>} config - The parsed config.
 * @returns {PawStamp | null} The stamp, or null when absent or malformed.
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
 * Classify what is already at the config path.
 *
 * @param {string | null} text - Existing file contents, or null when absent.
 * @returns {InitConflict} What was found.
 * @throws {Error} When a config is present but unreadable.
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
 * Combine an existing config with the keys PAW needs, existing values winning.
 *
 * A merge never removes and never rewrites: whatever the repo declared is what
 * it keeps, and PAW only fills in keys that are missing. The stale stamp is
 * dropped so the result can be stamped afresh.
 *
 * @param {Record<string, unknown>} existing - The config already on disk.
 * @param {Record<string, unknown>} incoming - The keys PAW wants present.
 * @returns {Record<string, unknown>} The merged config.
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
 * Say what a refusal is about, in the words the operator needs to act.
 *
 * @param {InitConflict} conflict - What was found.
 * @returns {string} The reason.
 */
function refusal(conflict: InitConflict): string {
  const detail =
    conflict.kind === 'stamped'
      ? `PAW wrote it (version ${conflict.stamp.version})${conflict.edited ? ' and it has been edited since' : ''}`
      : 'PAW did not write it';
  return `.paw/config.json already exists — ${detail}. Re-run with --merge to keep what is there and add what is missing, or --override to replace it.`;
}

/**
 * Decide what `init` does about the config.
 *
 * @param {string | null} existingText - Existing file contents, or null when absent.
 * @param {Record<string, unknown>} incoming - The keys PAW wants present.
 * @param {InitMode} mode - How the operator resolved a conflict.
 * @returns {InitOutcome} The decision.
 * @throws {Error} When a config is present but unreadable.
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
