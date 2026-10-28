/**
 * Node Backend Sync Tests
 *
 * @fileoverview Drive {@link syncRepoBackends} over a real repository directory: nothing enabled,
 * a plan refusal, a module that is enabled but absent, one that exports no backend or throws on
 * load, a module refusal that writes nothing, and a sync through this repository's own
 * `packages/openproject` linked into `.paw/modules` with a fake fetch, writing the task document
 * and the sidecar.
 *
 * @module @paw/adapters/test/config/nodeBackendSync
 */

import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BackendFetch } from '@paw/core';
import { syncRepoBackends } from '../../src/config/nodeBackendSync.js';

const OPENPROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..', 'openproject');

const ENABLED = { modules: ['paw-agile', 'paw-openproject'], connectors: ['openproject'] };

let root = '';

/**
 * Write the repository config.
 *
 * @param {Record<string, unknown>} config - Config document.
 * @returns {Promise<void>} When written.
 */
async function seed(config: Record<string, unknown>): Promise<void> {
  await mkdir(join(root, '.paw', 'modules'), { recursive: true });
  await writeFile(join(root, '.paw', 'config.json'), JSON.stringify(config), 'utf8');
}

/**
 * Link this repository's own OpenProject module into the fixture repo.
 *
 * @returns {Promise<void>} When linked.
 */
async function install(): Promise<void> {
  await symlink(OPENPROJECT, join(root, '.paw', 'modules', 'paw-openproject'), 'junction');
}

/**
 * Plant a module directory whose entry holds the given source.
 *
 * @param {string} source - Text of the module's `src/index.ts`.
 * @returns {Promise<void>} When written.
 */
async function plant(source: string): Promise<void> {
  const dir = join(root, '.paw', 'modules', 'paw-openproject');
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'package.json'), '{"name":"planted"}', 'utf8');
  await writeFile(join(dir, 'src', 'index.ts'), source, 'utf8');
}

/**
 * A fetch serving one collection page of the given work packages.
 *
 * @param {ReadonlyArray<{ id: number; subject: string; parent?: number }>} packages - Work packages.
 * @returns {BackendFetch} The fetch.
 */
function serving(packages: ReadonlyArray<{ id: number; subject: string; parent?: number }>): BackendFetch {
  const elements = packages.map(({ id, subject, parent }) => ({
    id,
    subject,
    updatedAt: '2026-10-28T15:00:00.000Z',
    _links: { parent: { href: parent === undefined ? null : `/api/v3/work_packages/${parent}` } },
  }));
  const body = JSON.stringify({ total: elements.length, _embedded: { elements } });
  return async () => ({ status: 200, text: async () => body });
}

/**
 * A repository file's text.
 *
 * @param {string} path - Repository-relative path.
 * @returns {Promise<string>} The text.
 */
function read(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'paw-backend-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('syncRepoBackends', () => {
  it('syncs nothing when no backend connector is enabled', async () => {
    await seed({ modules: ['paw-agile'] });
    expect(await syncRepoBackends(root, false, serving([]))).toEqual([]);
  });

  it('passes a plan refusal through', async () => {
    await seed({ modules: ['paw-agile'], connectors: ['openproject'] });
    expect(await syncRepoBackends(root, false, serving([]))).toEqual([
      {
        connector: 'openproject',
        ok: false,
        reason:
          'connector "openproject" syncs through module paw-openproject; enable it with paw modules enable paw-openproject',
      },
    ]);
  });

  it('refuses a sync module that is enabled but not installed, naming the install verb', async () => {
    await seed(ENABLED);
    const [report] = await syncRepoBackends(root, false, serving([]));
    expect(report).toMatchObject({ connector: 'openproject', ok: false });
    expect(report?.ok === false && report.reason).toMatch(
      /^module paw-openproject is enabled but not installed \(.*\); install it with paw modules install paw-openproject$/,
    );
  });

  it('refuses a module that exports no backend', async () => {
    await seed(ENABLED);
    await plant('export const backend = { files: null, sync: () => null };\n');
    const [report] = await syncRepoBackends(root, false, serving([]));
    expect(report?.ok === false && report.reason).toMatch(/index\.ts exports no backend$/);
  });

  it('refuses a module that throws on load, carrying the error', async () => {
    await seed(ENABLED);
    await plant("throw new Error('module exploded');\n");
    const [report] = await syncRepoBackends(root, false, serving([]));
    expect(report?.ok === false && report.reason).toMatch(/index\.ts failed to load: Error: module exploded$/);
  });

  it('writes nothing when the module refuses', async () => {
    await seed(ENABLED);
    await install();
    await writeFile(join(root, '.paw', 'tasks.json'), '{"tasks":[]}', 'utf8');
    expect(await syncRepoBackends(root, false, serving([]))).toEqual([
      { connector: 'openproject', ok: false, reason: '.paw/openproject.backend.env needs BASE_URL, KEY, PROJECT' },
    ]);
    expect(await read('.paw/tasks.json')).toBe('{"tasks":[]}');
  });

  it('syncs through the installed module and writes the task document and the sidecar', async () => {
    await seed(ENABLED);
    await install();
    await writeFile(
      join(root, '.paw', 'openproject.backend.env'),
      'BASE_URL=http://op.test\nKEY=k\nPROJECT=demo\n',
      'utf8',
    );
    const reports = await syncRepoBackends(
      root,
      false,
      serving([
        { id: 1, subject: 'Epic' },
        { id: 2, subject: 'Story', parent: 1 },
      ]),
    );
    expect(reports).toEqual([
      { connector: 'openproject', ok: true, mode: 'full', pulled: 2, removed: 0, refusals: [] },
    ]);
    expect(JSON.parse(await read('.paw/tasks.json'))).toMatchObject({
      tasks: [{ id: 'op-1', title: 'Epic' }, { id: 'op-2', title: 'Story' }],
      edges: [['op-1', 'op-2']],
    });
    expect(JSON.parse(await read('.paw/openproject.sync.json'))).toEqual({
      baseUrl: 'http://op.test',
      project: 'demo',
      cursor: '2026-10-28T15:00:00.000Z',
    });
    const [again] = await syncRepoBackends(root, true, serving([{ id: 1, subject: 'Epic' }]));
    expect(again).toMatchObject({ ok: true, mode: 'full', pulled: 1, removed: 1 });
  });

  it('throws when a file the module reads exists but cannot be read', async () => {
    await seed(ENABLED);
    await install();
    await mkdir(join(root, '.paw', 'openproject.backend.env'));
    await expect(syncRepoBackends(root, false, serving([]))).rejects.toThrow(/EISDIR/);
  });
});
