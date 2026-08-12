/**
 * @fileoverview Cover plan create/delete: name validation bounds what can
 * become a filename, path normalisation bounds what delete can remove, the
 * template scaffolds a loadable plan, and the control port creates and deletes
 * over a real temp filesystem. Filesystem failures answer 500, never explode
 * the request pipeline.
 *
 * @module @paw/daemon/test/plansControl
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { plansControl } from '../src/application/plansControl.js';
import {
  planNameValid,
  planPathFor,
  planTemplate,
  safePlanPath,
} from '../src/domain/plans.js';
import type { ControlRequest } from '../src/domain/control.js';

const req = (body: Record<string, unknown> = {}, query?: string): ControlRequest => ({
  body,
  query: query === undefined ? undefined : new URLSearchParams(query),
});

const dirs: string[] = [];
const tempRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'paw-plans-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('planNameValid', () => {
  it('takes kebab-case names', () => {
    expect(planNameValid('caveman-jsdoc')).toBe(true);
    expect(planNameValid('a')).toBe(true);
    expect(planNameValid('plan2')).toBe(true);
  });

  it('refuses path characters, case, leading dash, emptiness, and length', () => {
    expect(planNameValid('')).toBe(false);
    expect(planNameValid('-lead')).toBe(false);
    expect(planNameValid('Upper')).toBe(false);
    expect(planNameValid('a/b')).toBe(false);
    expect(planNameValid('a.b')).toBe(false);
    expect(planNameValid('..')).toBe(false);
    expect(planNameValid('x'.repeat(65))).toBe(false);
  });
});

describe('safePlanPath', () => {
  it('normalises separators and a leading dot-slash', () => {
    expect(safePlanPath('plans\\demo.swarm.mjs')).toBe('plans/demo.swarm.mjs');
    expect(safePlanPath('./plans/demo.swarm.mjs')).toBe('plans/demo.swarm.mjs');
  });

  it('refuses traversal, absolute paths, drive letters, wrong suffix, and empties', () => {
    expect(safePlanPath('')).toBeNull();
    expect(safePlanPath('plans/demo.mjs')).toBeNull();
    expect(safePlanPath('../demo.swarm.mjs')).toBeNull();
    expect(safePlanPath('plans/../../x.swarm.mjs')).toBeNull();
    expect(safePlanPath('/etc/x.swarm.mjs')).toBeNull();
    expect(safePlanPath('C:/x.swarm.mjs')).toBeNull();
    expect(safePlanPath('plans//x.swarm.mjs')).toBeNull();
  });
});

describe('planTemplate', () => {
  it('scaffolds a loadable plan named for its file', async () => {
    const root = tempRoot();
    const file = join(root, 'starter.swarm.mjs');
    writeFileSync(file, planTemplate('starter'), 'utf8');
    const loaded = (await import(pathToFileURL(file).href)) as {
      default: {
        name: string;
        role: string;
        members(a: { files: string[] }): number;
        brief(a: { files: string[] }, m: number): string;
        key(a: { files: string[] }, m: number): string;
      };
    };
    expect(loaded.default.name).toBe('starter');
    expect(loaded.default.role).toBe('edit.apply');
    expect(loaded.default.members({ files: ['a', 'b'] })).toBe(2);
    expect(loaded.default.brief({ files: ['a.ts'] }, 0)).toContain('a.ts');
    expect(loaded.default.key({ files: ['a.ts'] }, 0)).toBe('a.ts');
  });
});

describe('plansControl', () => {
  const create = 'POST /api/plans';
  const remove = 'DELETE /api/plans';

  it('creates a plan from the template and reports its path', async () => {
    const root = tempRoot();
    const res = await plansControl(root).handlers[create](req({ name: 'fresh' }));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, plan: 'plans/fresh.swarm.mjs' });
    expect(readFileSync(join(root, planPathFor('fresh')), 'utf8')).toBe(planTemplate('fresh'));
  });

  it('refuses a bad or missing name before touching the filesystem', async () => {
    const root = tempRoot();
    for (const body of [{}, { name: '../x' }, { name: 42 }]) {
      const res = await plansControl(root).handlers[create](req(body as never));
      expect(res.status).toBe(422);
    }
    expect(existsSync(join(root, 'plans'))).toBe(false);
  });

  it('refuses to overwrite an existing plan', async () => {
    const root = tempRoot();
    const port = plansControl(root);
    await port.handlers[create](req({ name: 'twice' }));
    const res = await port.handlers[create](req({ name: 'twice' }));
    expect(res.status).toBe(422);
    expect((res.body as { reason: string }).reason).toContain('already exists');
  });

  it('deletes a plan named in the body or the query', async () => {
    const root = tempRoot();
    const port = plansControl(() => root);
    await port.handlers[create](req({ name: 'doomed' }));
    const res = await port.handlers[remove](req({ plan: 'plans/doomed.swarm.mjs' }));
    expect(res.status).toBe(200);
    expect(existsSync(join(root, planPathFor('doomed')))).toBe(false);

    await port.handlers[create](req({ name: 'doomed' }));
    const viaQuery = await port.handlers[remove](
      req({}, 'plan=plans%2Fdoomed.swarm.mjs'),
    );
    expect(viaQuery.status).toBe(200);
  });

  it('refuses unsafe delete paths and reports a missing plan as 404', async () => {
    const port = plansControl(tempRoot());
    expect((await port.handlers[remove](req())).status).toBe(422);
    expect((await port.handlers[remove](req({ plan: '../x.swarm.mjs' }))).status).toBe(422);
    expect((await port.handlers[remove](req({ plan: 'plans/none.swarm.mjs' }))).status).toBe(404);
  });

  it('answers 500 with the message when the filesystem fails', async () => {
    const boom = (): never => {
      throw new Error('disk on fire');
    };
    const created = await plansControl('/repo', {
      exists: () => false,
      mkdir: () => undefined,
      write: boom,
    }).handlers[create](req({ name: 'x' }));
    expect(created.status).toBe(500);
    expect((created.body as { reason: string }).reason).toBe('disk on fire');

    const deleted = await plansControl('/repo', { exists: () => true, remove: boom }).handlers[
      remove
    ](req({ plan: 'plans/x.swarm.mjs' }));
    expect(deleted.status).toBe(500);
  });

  it('maps a non-Error throw to its string form', async () => {
    const res = await plansControl('/repo', {
      exists: () => true,
      remove: () => {
        throw 'string failure';
      },
    }).handlers[remove](req({ plan: 'plans/x.swarm.mjs' }));
    expect(res.status).toBe(500);
    expect((res.body as { reason: string }).reason).toBe('string failure');
  });
});
