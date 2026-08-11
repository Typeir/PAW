/**
 * PAW Scope
 *
 * @fileoverview Which directory running daemon may point at.
 *
 * Scoping read: change what daemon look at, write nothing. No operator
 * approval, needs ceiling. Ceiling operator home; console open at working
 * directory `paw ui` launched from.
 *
 * Pure string work over injected paths; rules test for both separators from
 * either platform.
 *
 * @module @paw/core/domain/scope
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Normalise path for comparison: forward slashes, traversal resolved, no
 * trailing separator.
 *
 * @param {string} path - Path.
 * @returns {string[]} Resolved segments.
 */
function segments(path: string): string[] {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out;
}

/**
 * Whether candidate directory be root or lie beneath it. Compare segment by
 * segment.
 *
 * @param {string} candidate - Directory console named.
 * @param {string} root - Ceiling it must not escape.
 * @returns {boolean} True when candidate within the root.
 */
export function withinRoot(candidate: string, root: string): boolean {
  if (candidate.trim() === '' || root.trim() === '') {
    return false;
  }
  const target = segments(candidate);
  const ceiling = segments(root);
  if (target.length < ceiling.length) {
    return false;
  }
  return ceiling.every((part, index) => target[index] === part);
}