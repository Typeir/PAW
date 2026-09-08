/**
 * Node Module Resolver
 *
 * @fileoverview Locates a module by walking `node_modules` up from the served
 * repository and looking for the package manifest. A presence check, not a
 * Node import — `@paw/*` packages declare no `require` condition.
 *
 * @module @paw/adapters/config/nodeModuleResolver
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { access } from 'node:fs/promises';
import { dirname, join, resolve as resolvePath } from 'node:path';
import type { ModuleResolverPort } from '@paw/core';

/**
 * A directory and every directory above it.
 *
 * @param {string} from - Directory to start at.
 * @returns {string[]} Directories, nearest first.
 */
function ancestors(from: string): string[] {
  const chain: string[] = [];
  let dir = from;
  let up = dirname(dir);
  while (up !== dir) {
    chain.push(dir);
    dir = up;
    up = dirname(dir);
  }
  chain.push(dir);
  return chain;
}

/**
 * Build a resolver rooted at a repository.
 *
 * @param {string} root - Repository the specifier resolves from.
 * @returns {ModuleResolverPort} The resolver.
 */
export function createNodeModuleResolver(root: string): ModuleResolverPort {
  const from = resolvePath(root);
  return {
    async resolve(specifier: string) {
      for (const dir of ancestors(from)) {
        const manifest = join(dir, 'node_modules', ...specifier.split('/'), 'package.json');
        try {
          await access(manifest);
          return { resolved: true, detail: manifest };
        } catch {
          continue;
        }
      }
      return { resolved: false, detail: `no node_modules/${specifier} at or above ${from}` };
    },
  };
}
