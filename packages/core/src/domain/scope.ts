/**
 * PAW Scope
 *
 * @fileoverview Which directory a running daemon may be pointed at.
 *
 * Scoping is a read: it changes what the daemon looks at, the way `watch`
 * changes which plan it reports, and it writes nothing. So it needs no operator
 * approval — but it does need a ceiling, because a console that could name any
 * directory could read any directory through the daemon. The ceiling is the
 * operator's home; the console opens at the working directory `paw ui` was
 * launched from, which makes the common case one click without making the
 * console a filesystem browser for the whole disk.
 *
 * Pure string work over injected paths, so the rules are tested for both
 * separators from either platform.
 *
 * @module @paw/core/domain/scope
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Normalise a path for comparison: forward slashes, traversal resolved, no
 * trailing separator. Comparing raw strings would let `..` walk out of a root
 * that a prefix check said it was inside.
 *
 * @param {string} path - The path.
 * @returns {string[]} The resolved segments.
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
 * Whether a candidate directory is the root or lies beneath it.
 *
 * Compared segment by segment rather than by string prefix, so `/home/xyz` is
 * not treated as inside `/home/x`.
 *
 * @param {string} candidate - The directory a console named.
 * @param {string} root - The ceiling it must not escape.
 * @returns {boolean} True when the candidate is within the root.
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
