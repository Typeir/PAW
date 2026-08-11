/**
 * PAW Path Text
 *
 * @fileoverview Join and trim path with string work. Replace `node:path`.
 * Core import no Node builtin; `@paw/gui` bundle for browser. Use
 * forward slash all way. Every platform filesystem API, Windows too,
 * accept them.
 *
 * @module @paw/core/domain/paths
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Join path segment. Drop empty and trailing separator.
 *
 * @param {readonly string[]} parts - Segment.
 * @returns {string} Joined path.
 */
export function joinPath(parts: readonly string[]): string {
  return parts
    .map((part) => part.replace(/\\/g, '/').replace(/\/+$/, ''))
    .filter((part) => part !== '')
    .join('/');
}

/**
 * Directory path sit in, or `''` when no directory.
 *
 * @param {string} path - Path.
 * @returns {string} Directory.
 */
export function dirNameOf(path: string): string {
  const normalised = path.replace(/\\/g, '/');
  const cut = normalised.lastIndexOf('/');
  return cut <= 0 ? '' : normalised.slice(0, cut);
}