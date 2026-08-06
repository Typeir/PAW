/**
 * PAW Installer Node Filesystem Adapter
 *
 * @fileoverview The real {@link FileSystemPort} over `node:fs/promises`. A missing
 * file reads as `''` (the planners treat absence and emptiness the same); a write
 * creates parents; the executable bit is set on POSIX and a harmless no-op on
 * Windows. This is I/O, so it is excluded from coverage and driven only by the
 * installer shell.
 *
 * @module @paw/installer/adapters/nodeFs
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { appendFile, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import type { FileSystemPort } from '../ports.js';

/**
 * Create the Node filesystem adapter.
 *
 * @returns {FileSystemPort} A filesystem port backed by `node:fs/promises`.
 */
export function createNodeFs(): FileSystemPort {
  return {
    async readText(path) {
      try {
        return await readFile(path, 'utf8');
      } catch {
        return '';
      }
    },
    async writeText(path, content) {
      await writeFile(path, content, 'utf8');
    },
    async appendText(path, content) {
      await appendFile(path, content, 'utf8');
    },
    async ensureDir(dir) {
      await mkdir(dir, { recursive: true });
    },
    async setExecutable(path) {
      if (process.platform !== 'win32') {
        await chmod(path, 0o755);
      }
    },
  };
}
