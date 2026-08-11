/**
 * PAW Node File Reader Tests
 *
 * @fileoverview Run reader against real temp directory. One readable file, one
 * nested file, one missing file, one env file, two ways out of root — `..`
 * traversal and absolute path elsewhere on disk. Assert every refusal.
 *
 * @module @paw/adapters/test/file/nodeFileReader
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNodeFileReader, resolveInRoot } from '../../src/file/nodeFileReader.js';

let root = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'paw-reader-'));
  await writeFile(join(root, 'style.md'), 'be terse', 'utf8');
  await writeFile(join(root, '.env.local'), 'DEEPSEEK_API_KEY=secret', 'utf8');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'a.ts'), 'export {};', 'utf8');
});

afterAll(() => {
  root = '';
});

describe('createNodeFileReader', () => {
  it('reads a file inside the root, nested or not', async () => {
    const reader = createNodeFileReader(root);
    await expect(reader.read('style.md')).resolves.toBe('be terse');
    await expect(reader.read('src/a.ts')).resolves.toBe('export {};');
  });

  it('rejects a path that does not exist rather than reading nothing', async () => {
    await expect(createNodeFileReader(root).read('missing.md')).rejects.toThrow();
  });

  it('refuses an environment file wherever it sits', async () => {
    const reader = createNodeFileReader(root);
    await expect(reader.read('.env.local')).rejects.toThrow('refusing to attach an environment file');
    await expect(reader.read('src/../.env.local')).rejects.toThrow('environment file');
  });

  it('refuses to climb out of the root', async () => {
    const reader = createNodeFileReader(root);
    await expect(reader.read('../elsewhere.md')).rejects.toThrow('outside the root');
    await expect(reader.read(join(tmpdir(), 'elsewhere.md'))).rejects.toThrow('outside the root');
  });

  it('defaults to the working directory', async () => {
    await expect(createNodeFileReader().read('package.json')).resolves.toContain('@paw/adapters');
  });
});

describe('resolveInRoot', () => {
  it('resolves a path inside the root and refuses one outside it', () => {
    expect(resolveInRoot(root, 'style.md')).toBe(join(root, 'style.md'));
    expect(() => resolveInRoot(root, '..')).toThrow('outside the root');
  });
});
