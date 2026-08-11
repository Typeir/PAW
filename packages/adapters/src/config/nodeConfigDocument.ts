/**
 * PAW Node Config Document Adapter
 *
 * @fileoverview {@link ConfigDocumentPort} over `node:fs`. Read and write whole
 * repo `.paw/config.json`. Repo with no config read as empty document.
 * Malformed one throw.
 *
 * @module @paw/adapters/config/nodeConfigDocument
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ConfigDocument, ConfigDocumentPort } from '@paw/core';

/**
 * Config-document port bound to repository `.paw/config.json`. Root may be
 * getter, resolve fresh each read and write.
 *
 * @param {string | (() => string)} root - Repository root, or getter for current one.
 * @returns {ConfigDocumentPort} The port.
 */
export function createNodeConfigDocument(root: string | (() => string)): ConfigDocumentPort {
  const currentRoot = typeof root === 'function' ? root : (): string => root;
  const fileFor = (): string => resolve(currentRoot(), '.paw', 'config.json');
  return {
    async read(): Promise<ConfigDocument> {
      try {
        return JSON.parse(await readFile(fileFor(), 'utf8')) as ConfigDocument;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return {};
        }
        throw err;
      }
    },
    async write(config: ConfigDocument): Promise<void> {
      const file = fileFor();
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    },
  };
}
