/**
 * PAW Node Config Document Adapter
 *
 * @fileoverview The {@link ConfigDocumentPort} over `node:fs`, reading and writing
 * a repo's `.paw/config.json` whole. A repo with no config reads as an empty
 * document; a malformed one fails loud rather than being silently overwritten.
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
 * A config-document port bound to a repository's `.paw/config.json`.
 *
 * @param {string} root - The repository root.
 * @returns {ConfigDocumentPort} The port.
 */
export function createNodeConfigDocument(root: string): ConfigDocumentPort {
  const file = resolve(root, '.paw', 'config.json');
  return {
    async read(): Promise<ConfigDocument> {
      try {
        return JSON.parse(await readFile(file, 'utf8')) as ConfigDocument;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return {};
        }
        throw err;
      }
    },
    async write(config: ConfigDocument): Promise<void> {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    },
  };
}
