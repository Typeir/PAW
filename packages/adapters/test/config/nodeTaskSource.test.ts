/**
 * Node Work Model Source Tests
 *
 * @fileoverview Read a real repository directory through the three states a
 * caller must tell apart: the module is off, it is on but not installed, and it
 * is installed and loaded. The installed case links this repository's own
 * `packages/agile` into `.paw/modules`, so the dynamic load is exercised for
 * real rather than doubled.
 *
 * @module @paw/adapters/test/config/nodeTaskSource
 */

import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AGILE_MODULE, ROLLUP_FIELD, openRepoWorkModel } from '../../src/config/nodeTaskSource.js';

const AGILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../..', 'agile');

let root = '';

/**
 * Write a repository config, and a task document when given one.
 *
 * @param {Record<string, unknown>} config - Config document.
 * @param {string} [tasks] - Task document text.
 * @returns {Promise<void>} When written.
 */
async function seed(config: Record<string, unknown>, tasks?: string): Promise<void> {
  await mkdir(join(root, '.paw'), { recursive: true });
  await writeFile(join(root, '.paw', 'config.json'), JSON.stringify(config), 'utf8');
  if (tasks !== undefined) {
    await writeFile(join(root, '.paw', 'tasks.json'), tasks, 'utf8');
  }
}

/**
 * Install this repository's own work-model module into the fixture repo.
 *
 * @returns {Promise<boolean>} True when the link was made.
 */
async function install(): Promise<boolean> {
  await mkdir(join(root, '.paw', 'modules'), { recursive: true });
  try {
    await symlink(AGILE, join(root, '.paw', 'modules', AGILE_MODULE), 'junction');
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'paw-tasks-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('openRepoWorkModel', () => {
  it('loads nothing when the module is not enabled', async () => {
    await seed({ root: '.paw' }, JSON.stringify({ tasks: [{ id: 'a' }] }));
    expect(await openRepoWorkModel(root)).toEqual({
      enabled: false,
      installed: false,
      model: null,
      document: '',
      detail: 'paw-agile is not enabled in .paw/config.json',
    });
  });

  it('reports enabled but not installed when no module is present, naming where it looked', async () => {
    await seed({ modules: [AGILE_MODULE] }, JSON.stringify({ tasks: [{ id: 'a' }] }));
    const opened = await openRepoWorkModel(root);
    expect(opened).toMatchObject({ enabled: true, installed: false, model: null, document: '' });
    expect(opened.detail).toContain('no paw-agile in .paw/modules');
  });

  it('loads the installed module and reads the document', async () => {
    await seed(
      { modules: [AGILE_MODULE] },
      JSON.stringify({
        tasks: [{ id: 'a', fields: { points: 1 } }, { id: 'b', fields: { points: 1 } }],
        edges: [
          ['a', 'b'],
          ['b', 'a'],
          ['ghost', 'b'],
        ],
      }),
    );
    expect(await install()).toBe(true);

    const opened = await openRepoWorkModel(root);
    expect(opened).toMatchObject({ enabled: true, installed: true });
    expect(opened.model).not.toBeNull();
    expect(opened.detail).toBe(join(root, '.paw', 'modules', AGILE_MODULE, 'src', 'index.ts'));

    const view = opened.model?.view(opened.document, ROLLUP_FIELD);
    expect(view?.rows.map((row) => row.id)).toEqual(['a', 'b']);
    expect(view?.loops).toEqual([{ parent: 'b', child: 'a' }]);
    expect(view?.dangling).toEqual([{ parent: 'ghost', child: 'b' }]);
    expect(view?.rows.find((row) => row.id === 'b')?.orphan).toBe(true);

    expect(opened.model?.detail(opened.document, 'a', ROLLUP_FIELD)?.row.rollup).toBe(2);
    expect(opened.model?.detail(opened.document, 'ghost', ROLLUP_FIELD)).toBeNull();
  });

  it('reads an empty document when the installed repository holds none', async () => {
    await seed({ modules: [AGILE_MODULE] });
    expect(await install()).toBe(true);
    const opened = await openRepoWorkModel(root);
    expect(opened).toMatchObject({ enabled: true, installed: true, document: '' });
    expect(opened.model?.view(opened.document, ROLLUP_FIELD)).toMatchObject({
      rows: [],
      refusals: [],
    });
  });

  it('reports not installed when the module directory exports no work model, and says so', async () => {
    await seed({ modules: [AGILE_MODULE] });
    await plant('export const nothing = 1;\n');
    const opened = await openRepoWorkModel(root);
    expect(opened).toMatchObject({ enabled: true, installed: false, model: null });
    expect(opened.detail).toMatch(/index\.ts exports no workModel$/);
  });

  it('reports not installed when the module throws on load, carrying the error', async () => {
    await seed({ modules: [AGILE_MODULE] });
    await plant("throw new Error('module exploded');\n");
    const opened = await openRepoWorkModel(root);
    expect(opened).toMatchObject({ enabled: true, installed: false, model: null });
    expect(opened.detail).toMatch(/index\.ts failed to load: Error: module exploded$/);
  });

  it('throws when the task document exists but cannot be read', async () => {
    await seed({ modules: [AGILE_MODULE] });
    expect(await install()).toBe(true);
    await mkdir(join(root, '.paw', 'tasks.json'));
    await expect(openRepoWorkModel(root)).rejects.toThrow(/EISDIR/);
  });
});

/**
 * Plant a module directory whose entry holds the given source.
 *
 * @param {string} source - Text of the module's `src/index.ts`.
 * @returns {Promise<void>} When written.
 */
async function plant(source: string): Promise<void> {
  const dir = join(root, '.paw', 'modules', AGILE_MODULE);
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'package.json'), '{"name":"planted"}', 'utf8');
  await writeFile(join(dir, 'src', 'index.ts'), source, 'utf8');
}
