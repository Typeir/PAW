/**
 * PAW Node File Reader Adapter
 *
 * @fileoverview {@link FileReaderPort} over `node:fs`. Reads swarm's attached
 * context off disk. Each path resolves against the root directory; a path
 * resolving outside the root is rejected, and so is an environment file as
 * `isEnvFile` defines it. An unreadable path rejects.
 *
 * @module @paw/adapters/file/nodeFileReader
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { isEnvFile, type FileReaderPort } from '@paw/core';

/**
 * Resolve the requested path inside the root directory; reject any path that resolves outside it.
 *
 * @param {string} root - The absolute root directory.
 * @param {string} path - The requested path, relative to root or absolute.
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
 * Create Node file reader.
 *
 * @param {string} [root] - Root directory reads are limited to; defaults to working directory.
 * @returns {FileReaderPort} File reader rooted at `root`.
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
