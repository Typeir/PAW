/**
 * Node Optional Text
 *
 * @fileoverview Reads a file that may not exist: a missing file is blank text, any other failure
 * throws.
 *
 * @module @paw/adapters/config/optionalText
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { readFile } from 'node:fs/promises';

/**
 * A file's text, blank when it does not exist.
 *
 * @param {string} path - Absolute path.
 * @returns {Promise<string>} The text.
 * @throws {Error} Any read failure other than a missing file.
 */
export async function readOptionalText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw err;
  }
}
