/**
 * PAW Project Path
 *
 * @fileoverview Map path to PAW domain form: project-relative, forward-slashed.
 * Host send absolute path (VS Code Copilot send `c:\repo\src\a.ts`); gates, violations,
 * enforcement comparisons work in project-relative path. Map absolute path under root
 * back to relative, no case care for Windows; leave already-relative path, or path
 * outside root, untouched.
 *
 * @module @paw/core/domain/projectPath
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Normalise maybe-absolute path to project-relative, forward-slashed.
 *
 * @param {string} root - Absolute project root.
 * @param {string} path - Path to normalise.
 * @returns {string} Path relative to root, or unchanged when already relative
 * or outside root; `.` when it is root itself.
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