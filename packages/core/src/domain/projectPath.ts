/**
 * PAW Project Path
 *
 * @fileoverview A host may hand PAW absolute paths (VS Code Copilot sends
 * `c:\repo\src\a.ts`), but PAW's domain works in project-relative, forward-slash
 * paths — that is what a gate's `readFile` joins to the root, what a violation
 * stores, and what one enforcement decision compares against another. Feeding an
 * absolute path straight in doubled it (`join(root, abs)`), the gate threw
 * ENOENT, and every finding degraded to a `gate-error`. This maps an absolute
 * path under the root back to relative — case-insensitively, because Windows —
 * and leaves an already-relative path, or one outside the root, untouched.
 *
 * @module @paw/core/domain/projectPath
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Normalise a possibly-absolute path to project-relative, forward-slashed.
 *
 * @param {string} root - The absolute project root.
 * @param {string} path - The path to normalise.
 * @returns {string} The path relative to the root, or unchanged when already
 * relative or outside the root; `.` when it is the root itself.
 */
export function toProjectRelative(root: string, path: string): string {
  const norm = path.replace(/\\/g, '/');
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (norm.toLowerCase() === base.toLowerCase()) {
    return '.';
  }
  return norm.toLowerCase().startsWith(`${base.toLowerCase()}/`)
    ? norm.slice(base.length + 1)
    : norm;
}
