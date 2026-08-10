/**
 * PAW Node Config Document Adapter Tests
 *
 * @fileoverview A round trip through a real `.paw/config.json` in a temp repo:
 * an absent config reads empty, a write creates the directory and round-trips,
 * and a malformed config fails loud rather than reading as empty. A getter root
 * is resolved per write, so a moved scope writes to whichever repo it currently
 * names. So `nodeConfigDocument.ts` reaches 100%.
 *
 * @module @paw/adapters/test/config/nodeConfigDocument
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigDocument } from '@paw/core';
import { createNodeConfigDocument } from '../../src/config/nodeConfigDocument.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'paw-config-'));
});

afterEach(async () => {
  await import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }));
});

describe('createNodeConfigDocument', () => {
  it('reads an absent config as an empty document', async () => {
    expect(await createNodeConfigDocument(root).read()).toEqual({});
  });

  it('creates .paw and round-trips a written document', async () => {
    const port = createNodeConfigDocument(root);
    const doc = { root: '.paw', models: {}, roles: { 'edit.apply': 'fast' } };
    await port.write(doc);
    expect(await port.read()).toEqual(doc);
    const raw = await readFile(join(root, '.paw', 'config.json'), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('fails loud on a malformed config rather than reading empty', async () => {
    await mkdir(join(root, '.paw'), { recursive: true });
    await writeFile(join(root, '.paw', 'config.json'), '{ not json', 'utf8');
    await expect(createNodeConfigDocument(root).read()).rejects.toThrow();
  });

  it('follows a scope getter, writing to whichever root it currently names', async () => {
    const other = await mkdtemp(join(tmpdir(), 'paw-config-b-'));
    try {
      let held = root;
      const port = createNodeConfigDocument(() => held);
      await port.write({ roles: { 'edit.apply': 'here' } });
      held = other;
      await port.write({ roles: { 'edit.apply': 'there' } });
      const read = async (base: string): Promise<ConfigDocument> =>
        JSON.parse(await readFile(join(base, '.paw', 'config.json'), 'utf8')) as ConfigDocument;
      expect((await read(root)).roles?.['edit.apply']).toBe('here');
      expect((await read(other)).roles?.['edit.apply']).toBe('there');
    } finally {
      await import('node:fs/promises').then((fs) => fs.rm(other, { recursive: true, force: true }));
    }
  });
});
