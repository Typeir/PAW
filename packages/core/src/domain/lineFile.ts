/**
 * PAW Line File
 *
 * @fileoverview Edits to newline-separated files where each line is an entry,
 * such as `.gitignore` and `.git/info/exclude`.
 *
 * @module @paw/core/domain/lineFile
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * File text with each line present once; existing text kept in place, missing lines appended.
 *
 * @param {string} text - Current file text; empty when the file does not exist.
 * @param {readonly string[]} lines - Lines that must be present, without newlines.
 * @returns {string} New file text; the input unchanged when no line is missing.
 */
export function withLines(text: string, lines: readonly string[]): string {
  const present = new Set(text.split('\n'));
  const missing = lines.filter((line) => !present.has(line));
  if (missing.length === 0) {
    return text;
  }
  const base = text === '' || text.endsWith('\n') ? text : `${text}\n`;
  return `${base}${missing.join('\n')}\n`;
}
