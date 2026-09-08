/**
 * Node Task Source Tests
 *
 * @fileoverview Read a real repository directory: module off, module on with a
 * document, module on with none, and a document the kernel partly refuses.
 *
 * @module @paw/adapters/test/config/nodeTaskSource
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AGILE_MODULE, readRepoTasks } from '../../src/config/nodeTaskSource.js';

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

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'paw-tasks-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('readRepoTasks', () => {
  it('reads nothing when the module is not enabled', async () => {
    await seed({ root: '.paw' }, JSON.stringify({ tasks: [{ id: 'a' }] }));
    const result = await readRepoTasks(root);
    expect(result.enabled).toBe(false);
    expect(result.graph.tasks.size).toBe(0);
    expect(result.refusals).toEqual([]);
  });

  it('builds the graph when the module is enabled', async () => {
    await seed(
      { modules: [AGILE_MODULE] },
      JSON.stringify({ tasks: [{ id: 'a' }, { id: 'b' }], edges: [['a', 'b']] }),
    );
    const result = await readRepoTasks(root);
    expect(result.enabled).toBe(true);
    expect(result.graph.tasks.size).toBe(2);
    expect(result.refusals).toEqual([]);
  });

  it('reports an empty graph when the repository holds no task document', async () => {
    await seed({ modules: [AGILE_MODULE] });
    const result = await readRepoTasks(root);
    expect(result).toMatchObject({ enabled: true, refusals: [] });
    expect(result.graph.tasks.size).toBe(0);
  });

  it('declares a ring the document closes rather than refusing it', async () => {
    await seed(
      { modules: [AGILE_MODULE] },
      JSON.stringify({
        tasks: [{ id: 'a' }, { id: 'b' }],
        edges: [
          ['a', 'b'],
          ['b', 'a'],
        ],
      }),
    );
    const result = await readRepoTasks(root);
    expect(result.graph.tasks.size).toBe(2);
    expect(result.graph.loops).toEqual([{ parent: 'b', child: 'a' }]);
    expect(result.refusals).toEqual([]);
  });

  it('records an edge naming an absent task rather than refusing it', async () => {
    await seed(
      { modules: [AGILE_MODULE] },
      JSON.stringify({ tasks: [{ id: 'a' }], edges: [['a', 'ghost']] }),
    );
    const result = await readRepoTasks(root);
    expect(result.refusals).toEqual([]);
    expect(result.graph.dangling).toEqual([{ parent: 'a', child: 'ghost' }]);
  });
});
