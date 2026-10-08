/**
 * PAW Environment File
 *
 * @fileoverview The one definition of an environment file — a file that may
 * hold credentials and must never enter model context. Hook connectors and the
 * attached-context reader both refuse what it matches.
 *
 * @module @paw/core/domain/envFile
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Whether a path names an environment file: its basename starts or ends with
 * `.env`. Matches `.env`, `.env.local`, `.envrc`, and `<name>.provider.env`;
 * passes `.venv`, `dotenv`, and `printenv`. Accepts `/` and `\` separators.
 *
 * @param {string} path - File path or shell word, relative or absolute.
 * @returns {boolean} True for an environment file; false for an empty basename.
 */
export function isEnvFile(path: string): boolean {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  return name.startsWith('.env') || name.endsWith('.env');
}
