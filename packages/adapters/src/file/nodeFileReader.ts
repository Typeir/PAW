/**
 * PAW Node File Reader Adapter
 *
 * @fileoverview The {@link FileReaderPort} implementation over `node:fs`, and the
 * only place a swarm's attached context is actually read off disk. It is rooted:
 * every path resolves against a root directory and a path that escapes that root
 * is refused, so a selection that arrived from a browser — or a plan computing
 * paths from data — cannot reach into the rest of the machine. Environment files
 * are refused outright; secrets belong behind the keyring port, never in a
 * prompt. Fails loud per CONSTRAINTS.md Constraint 3: an unreadable path rejects
 * rather than resolving to an empty string a model would silently be told is the
 * file's content.
 *
 * @module @paw/adapters/file/nodeFileReader
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import type { FileReaderPort } from '@paw/core';

/**
 * Whether a filename is an environment file, which is never attachable.
 *
 * @param {string} path - The path being read.
 * @returns {boolean} True when the basename looks like a `.env` file.
 */
function isEnvFile(path: string): boolean {
  return basename(path).startsWith('.env');
}

/**
 * Resolve a requested path inside the root, refusing anything that escapes it.
 *
 * @param {string} root - The absolute root directory.
 * @param {string} path - The requested path, relative to the root or absolute.
 * @returns {string} The absolute path to read.
 */
export function resolveInRoot(root: string, path: string): string {
  const absolute = resolve(root, path);
  const inside = relative(root, absolute);
  if (inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error(`refusing to read outside the root: ${path}`);
  }
  return absolute;
}

/**
 * Create the Node file reader.
 *
 * @param {string} [root] - The directory reads are confined to; defaults to the working directory.
 * @returns {FileReaderPort} A file reader rooted at `root`.
 */
export function createNodeFileReader(root: string = process.cwd()): FileReaderPort {
  const base = resolve(root);
  return {
    read: async (path: string): Promise<string> => {
      if (isEnvFile(path)) {
        throw new Error(`refusing to attach an environment file: ${path}`);
      }
      return readFile(resolveInRoot(base, path), 'utf8');
    },
  };
}
