/**
 * Node Module Resolver Tests
 *
 * @fileoverview Find a package in the root's own `node_modules`, find one only
 * an ancestor holds, and report a specifier no directory in the chain holds.
 *
 * @module @paw/adapters/test/config/nodeModuleResolver
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createNodeModuleResolver } from '../../src/config/nodeModuleResolver.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('createNodeModuleResolver', () => {
  it('finds a package in the root’s own node_modules', async () => {
    const found = await createNodeModuleResolver(ROOT).resolve('vitest');
    expect(found.resolved).toBe(true);
    expect(found.detail).toBe(join(ROOT, 'node_modules', 'vitest', 'package.json'));
  });

  it('finds a scoped package an ancestor holds, walking up from a subdirectory', async () => {
    const found = await createNodeModuleResolver(join(ROOT, 'src', 'config')).resolve('@paw/core');
    expect(found.resolved).toBe(true);
    expect(found.detail).toBe(join(ROOT, 'node_modules', '@paw', 'core', 'package.json'));
  });

  it('reports the chain it searched for a specifier nobody holds', async () => {
    const missing = await createNodeModuleResolver(ROOT).resolve('@paw/not-a-module');
    expect(missing.resolved).toBe(false);
    expect(missing.detail).toContain('@paw/not-a-module');
    expect(missing.detail).toContain(ROOT);
  });
});
