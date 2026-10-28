/**
 * @fileoverview Live project: seeds a project and subproject on the compose instance with an
 * Epic → Feature → User story → Task ladder across both and a closed task, then holds the env,
 * sidecar, and task document texts as a host would and checks `backend.sync` end to end: the
 * first sweep, a delta carrying an edit and a re-parent, and a deletion a delta keeps and a full
 * sweep removes. Each run seeds fresh projects and deletes them afterwards.
 *
 * @module @paw/openproject/test/live/sync
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backend, type SyncResult } from '../../src/index.js';
import { apiClient, BASE_URL, railsRunner, requireDocker, startInstance } from './instance.js';

type Api = ReturnType<typeof apiClient>;

/**
 * Host-side file texts between syncs.
 *
 * @interface Files
 * @property {string} env - Backend env text.
 * @property {string} state - Sidecar text.
 * @property {string} document - Task document text.
 */
interface Files {
  env: string;
  state: string;
  document: string;
}

/**
 * Work package ids the seed created.
 *
 * @interface Seeded
 * @property {number} epic - Epic in the root project.
 * @property {number} feature - Feature under the epic, root project.
 * @property {number} story - User story under the feature, subproject, 5 story points.
 * @property {number} task - Task under the story, subproject.
 * @property {number} closed - Closed task with no parent, root project.
 */
interface Seeded {
  epic: number;
  feature: number;
  story: number;
  task: number;
  closed: number;
}

const run = Date.now().toString(36);
const files: Files = { env: '', state: '', document: '' };
let api: Api;
let rootId: number;
let seeded: Seeded;

/**
 * Sync once through the module, keep the texts it returns, and return the result.
 *
 * @param {boolean} full - Force a full sweep.
 * @returns {Promise<Extract<SyncResult, { ok: true }>>} The successful result.
 * @throws {Error} With the module's reason on a refusal.
 */
async function syncOnce(full: boolean): Promise<Extract<SyncResult, { ok: true }>> {
  const result = await backend.sync({ ...files, full, fetch });
  if (!result.ok) {
    throw new Error(result.reason);
  }
  files.state = result.state;
  files.document = result.document;
  return result;
}

/**
 * The task document as parsed JSON.
 *
 * @returns {{ tasks: Array<{ id: string; title: string; fields: Record<string, unknown> }>; edges: string[][] }} The document.
 */
function documentNow(): { tasks: Array<{ id: string; title: string; fields: Record<string, unknown> }>; edges: string[][] } {
  return JSON.parse(files.document);
}

/**
 * Create one work package.
 *
 * @param {number} project - Project id.
 * @param {number} type - Type id.
 * @param {string} subject - Subject.
 * @param {Record<string, unknown>} [extra] - Extra properties and links.
 * @returns {Promise<any>} The created work package.
 */
async function create(project: number, type: number, subject: string, extra: Record<string, unknown> = {}): Promise<any> {
  const { _links: links = {}, ...properties } = extra as { _links?: Record<string, unknown> };
  return api('POST', `/api/v3/projects/${project}/work_packages`, {
    subject,
    ...properties,
    _links: { type: { href: `/api/v3/types/${type}` }, ...links },
  });
}

/**
 * A link to a work package.
 *
 * @param {number} id - Work package id.
 * @returns {{ href: string }} The link.
 */
function wpLink(id: number): { href: string } {
  return { href: `/api/v3/work_packages/${id}` };
}

/**
 * Wait past the server's clock tick so the next change lands after the cursor.
 *
 * @returns {Promise<void>} Resolves after 1.1 s.
 */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1_100));
}

beforeAll(async () => {
  requireDocker();
  await startInstance();
  const token = railsRunner('mint.rb', [`paw-live-${run}`], 'PAW_TOKEN');
  api = apiClient(token);
  const root = await api('POST', '/api/v3/projects', { name: `PAW live ${run}`, identifier: `paw-live-${run}` });
  const sub = await api('POST', '/api/v3/projects', {
    name: `PAW live ${run} sub`,
    identifier: `paw-live-${run}-sub`,
    _links: { parent: { href: `/api/v3/projects/${root.id}` } },
  });
  rootId = root.id;
  railsRunner('ladder.rb', [root.identifier, sub.identifier], 'PAW_LADDER');
  const types = (await api('GET', '/api/v3/types'))._embedded.elements as Array<{ id: number; name: string }>;
  const type = (name: string): number => (types.find((t) => t.name === name) as { id: number }).id;
  const epic = await create(root.id, type('Epic'), 'Checkout epic');
  const feature = await create(root.id, type('Feature'), 'Card payments', { _links: { parent: wpLink(epic.id) } });
  const story = await create(sub.id, type('User story'), 'Pay with card', {
    storyPoints: 5,
    _links: { parent: wpLink(feature.id) },
  });
  const task = await create(sub.id, type('Task'), 'Wire the card form', { _links: { parent: wpLink(story.id) } });
  const open = await create(root.id, type('Task'), 'Retired spike');
  const statuses = (await api('GET', '/api/v3/statuses'))._embedded.elements as Array<{ id: number; isClosed: boolean }>;
  const closedStatus = statuses.find((s) => s.isClosed) as { id: number };
  await api('PATCH', `/api/v3/work_packages/${open.id}`, {
    lockVersion: open.lockVersion,
    _links: { status: { href: `/api/v3/statuses/${closedStatus.id}` } },
  });
  seeded = { epic: epic.id, feature: feature.id, story: story.id, task: task.id, closed: open.id };
  files.env = `BASE_URL=${BASE_URL}\nKEY=${token}\nPROJECT=${root.identifier}\n`;
});

afterAll(async () => {
  if (api !== undefined && rootId !== undefined) {
    await api('DELETE', `/api/v3/projects/${rootId}`);
  }
});

describe('backend.sync against a live OpenProject', () => {
  it('sweeps the subtree on a first sync: every rung, the subproject, and the closed task', async () => {
    const result = await syncOnce(false);
    expect(result).toMatchObject({ mode: 'full', pulled: 5, removed: 0, refusals: [] });
    const document = documentNow();
    const id = (wp: number): string => `op-${wp}`;
    expect(document.tasks.map((t) => t.id)).toEqual(
      [seeded.epic, seeded.feature, seeded.story, seeded.task, seeded.closed].sort((a, b) => a - b).map(id),
    );
    expect(document.edges).toEqual(
      expect.arrayContaining([
        [id(seeded.epic), id(seeded.feature)],
        [id(seeded.feature), id(seeded.story)],
        [id(seeded.story), id(seeded.task)],
      ]),
    );
    expect(document.edges).toHaveLength(3);
    const story = document.tasks.find((t) => t.id === id(seeded.story));
    expect(story).toMatchObject({
      title: 'Pay with card',
      fields: { source: 'openproject', sourceId: seeded.story, type: 'User story', project: `PAW live ${run} sub`, points: 5 },
    });
    const page = await fetch(story?.fields.url as string, { redirect: 'manual' });
    expect(story?.fields.url).toBe(`${BASE_URL}/work_packages/${seeded.story}`);
    expect(page.status).toBeLessThan(400);
    const closed = document.tasks.find((t) => t.id === id(seeded.closed));
    expect(closed?.fields.status).not.toBe('New');
    expect(JSON.parse(files.state)).toMatchObject({ baseUrl: BASE_URL, project: `paw-live-${run}` });
  });

  it('pulls a delta carrying an edit and a re-parent, touching nothing else', async () => {
    await tick();
    const story = await api('GET', `/api/v3/work_packages/${seeded.story}`);
    await api('PATCH', `/api/v3/work_packages/${seeded.story}`, { lockVersion: story.lockVersion, subject: 'Pay with any card' });
    const task = await api('GET', `/api/v3/work_packages/${seeded.task}`);
    await api('PATCH', `/api/v3/work_packages/${seeded.task}`, {
      lockVersion: task.lockVersion,
      _links: { parent: wpLink(seeded.feature) },
    });
    const result = await syncOnce(false);
    expect(result.mode).toBe('delta');
    expect(result.removed).toBe(0);
    expect(result.pulled).toBeLessThan(5);
    const document = documentNow();
    expect(document.tasks).toHaveLength(5);
    expect(document.tasks.find((t) => t.id === `op-${seeded.story}`)?.title).toBe('Pay with any card');
    expect(document.edges).toContainEqual([`op-${seeded.feature}`, `op-${seeded.task}`]);
    expect(document.edges).not.toContainEqual([`op-${seeded.story}`, `op-${seeded.task}`]);
  });

  it('keeps a deleted work package through a delta and removes it on a full sweep', async () => {
    await api('DELETE', `/api/v3/work_packages/${seeded.closed}`);
    const delta = await syncOnce(false);
    expect(delta).toMatchObject({ mode: 'delta', removed: 0 });
    expect(documentNow().tasks.map((t) => t.id)).toContain(`op-${seeded.closed}`);
    const full = await syncOnce(true);
    expect(full).toMatchObject({ mode: 'full', pulled: 4, removed: 1 });
    expect(documentNow().tasks.map((t) => t.id)).not.toContain(`op-${seeded.closed}`);
  });
});
