/**
 * PAW Node Filesystem Adapter
 *
 * @fileoverview {@link FileSystemPort} over `node:fs/promises`, for one write
 * flow: attach PAW to repo. Missing file read give `''`; every other error
 * propagates, per CONSTRAINTS.md Constraint 3. Write make parents. Executable
 * bit set on POSIX, skip on Windows.
 *
 * @module @paw/adapters/file/nodeFs
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { FileSystemPort } from '@paw/core';
import { appendFile, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';

/**
 * Check rejection be Node "no such file". Narrow to `ENOENT`; other codes
 * propagate.
 *
 * @param {unknown} err - The rejection.
 * @returns {boolean} True when path no exist.
 */
function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/**
 * Make Node filesystem adapter.
 *
 * @param {NodeJS.Platform | string} [platform] - Platform, for executable bit; default to this process's.
 * @returns {FileSystemPort} Filesystem port behind `node:fs/promises`.
 */
export function createNodeFs(platform: string = process.platform): FileSystemPort {
  return {
    async readText(path: string): Promise<string> {
      try {
        return await readFile(path, 'utf8');
      } catch (err: unknown) {
        if (isMissing(err)) {
          return '';
        }
        throw err;
      }
    },

    async writeText(path: string, content: string): Promise<void> {
      await writeFile(path, content, 'utf8');
    },

    async appendText(path: string, content: string): Promise<void> {
      await appendFile(path, content, 'utf8');
    },

    async ensureDir(dir: string): Promise<void> {
      await mkdir(dir, { recursive: true });
    },

    async setExecutable(path: string): Promise<void> {
      if (platform !== 'win32') {
        await chmod(path, 0o755);
      }
    },
  };
}
