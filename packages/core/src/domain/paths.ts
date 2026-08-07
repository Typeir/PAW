/**
 * PAW Path Text
 *
 * @fileoverview Joining and trimming paths, as string work.
 *
 * `node:path` would do this, and core may not use it: `@paw/gui` compiles core
 * into a browser bundle, where a `node:` import is a build failure rather than a
 * runtime one. Core is therefore free of Node builtins entirely, and this is
 * what pays for that — a few lines of string handling in exchange for a library
 * that runs wherever it is asked to.
 *
 * Forward slashes throughout. Every platform's filesystem API accepts them,
 * including Windows, and one separator keeps a path comparable in a test.
 *
 * @module @paw/core/domain/paths
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Join path segments, dropping empties and any trailing separator.
 *
 * @param {readonly string[]} parts - The segments.
 * @returns {string} The joined path.
 */
export function joinPath(parts: readonly string[]): string {
  return parts
    .map((part) => part.replace(/\\/g, '/').replace(/\/+$/, ''))
    .filter((part) => part !== '')
    .join('/');
}

/**
 * The directory a path sits in, or `''` when it names no directory.
 *
 * @param {string} path - The path.
 * @returns {string} The directory.
 */
export function dirNameOf(path: string): string {
  const normalised = path.replace(/\\/g, '/');
  const cut = normalised.lastIndexOf('/');
  return cut <= 0 ? '' : normalised.slice(0, cut);
}
