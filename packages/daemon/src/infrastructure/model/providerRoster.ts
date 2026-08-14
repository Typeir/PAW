/**
 * PAW Provider Roster
 *
 * @fileoverview Key-free view of the configured providers, for the console's
 * Keys view. Scans `<root>/.paw/*.provider.env`, parses each through
 * {@link parseProviderEnv}, and strips the credential to its character count —
 * key material never crosses this boundary. A file that does not parse stays
 * on the roster with its reason, so a half-configured provider is visible, not
 * vanished.
 *
 * @module @paw/daemon/model/providerRoster
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseProviderEnv, providerNameOf } from './providerEnv.js';

/**
 * One provider as the console may see it. No key material; `keyChars` is the
 * credential's length only.
 *
 * @interface ProviderInfo
 * @property {string} name - Provider name, from the filename.
 * @property {string} [type] - Wire format, when the file parses.
 * @property {string} [baseUrl] - Endpoint, when the file parses.
 * @property {string} [model] - Default model id, when declared.
 * @property {number} [keyChars] - Credential length, when the file parses.
 * @property {string} [error] - Parse failure reason, for a broken file.
 */
export interface ProviderInfo {
  readonly name: string;
  readonly type?: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly keyChars?: number;
  readonly error?: string;
}

/**
 * Filesystem seams, for tests.
 *
 * @interface RosterSeams
 * @property {(dir: string) => string[]} [readDir] - List a directory; empty on failure.
 * @property {(path: string) => string} [readFile] - Read a file.
 */
export interface RosterSeams {
  readDir?(dir: string): string[];
  readFile?(path: string): string;
}

/**
 * The repo's provider roster, key-free, sorted by name. A missing `.paw`
 * directory is an empty roster.
 *
 * @param {string} root - Repository root.
 * @param {RosterSeams} [seams] - Injectable filesystem.
 * @returns {ProviderInfo[]} Roster entries.
 */
export function listProviders(root: string, seams: RosterSeams = {}): ProviderInfo[] {
  const readDir =
    seams.readDir ??
    ((dir: string): string[] => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    });
  const readFile = seams.readFile ?? ((path: string): string => readFileSync(path, 'utf8'));
  const pawDir = join(root, '.paw');
  const roster: ProviderInfo[] = [];
  for (const file of readDir(pawDir)) {
    const name = providerNameOf(file);
    if (name === null) {
      continue;
    }
    try {
      const profile = parseProviderEnv(name, readFile(join(pawDir, file)));
      roster.push({
        name,
        type: profile.type,
        baseUrl: profile.baseUrl,
        ...(profile.model === undefined ? {} : { model: profile.model }),
        keyChars: profile.key.length,
      });
    } catch (err: unknown) {
      roster.push({ name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return roster.sort((a, b) => a.name.localeCompare(b.name));
}
