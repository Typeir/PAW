/**
 * PAW Node Filesystem Adapter
 *
 * @fileoverview The real {@link FileSystemPort} over `node:fs/promises`, for the
 * one flow that writes: attaching PAW to a repository.
 *
 * A missing file reads as `''` because the planners treat absence and emptiness
 * the same, and this is the port's documented contract rather than a swallowed
 * error — every other failure propagates, per CONSTRAINTS.md Constraint 3. A
 * write creates its parents. The executable bit is set on POSIX and skipped on
 * Windows, which has no such bit to set.
 *
 * @module @paw/adapters/file/nodeFs
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { FileSystemPort } from '@paw/core';
import { appendFile, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';

/**
 * Whether a rejection is Node's "no such file".
 *
 * Narrowed to that one code so a permission error or a directory read is
 * reported rather than quietly answered with an empty file.
 *
 * @param {unknown} err - The rejection.
 * @returns {boolean} True when the path simply does not exist.
 */
function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/**
 * Create the Node filesystem adapter.
 *
 * @param {NodeJS.Platform | string} [platform] - The platform, for the executable bit; defaults to this process's.
 * @returns {FileSystemPort} A filesystem port backed by `node:fs/promises`.
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
