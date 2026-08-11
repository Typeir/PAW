/**
 * PAW Node Recent Routes Adapter Tests
 *
 * @fileoverview Round-trip `recent.json` in temp home. Absent file list
 * no routes. Record create file, round-trip. Repeated route promote to front.
 * Explicit cap applied. File not JSON array of strings throws. Cover
 * `nodeRecentRoutes.ts` to 100%.
 *
 * @module @paw/adapters/test/console/nodeRecentRoutes
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeRecentRoutes } from '../../src/console/nodeRecentRoutes.js';

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'paw-recent-'));
});

afterEach(async () => {
  await import('node:fs/promises').then((fs) => fs.rm(home, { recursive: true, force: true }));
});

describe('createNodeRecentRoutes', () => {
  it('lists no routes when nothing has been recorded', async () => {
    expect(await createNodeRecentRoutes(home).list()).toEqual([]);
  });

  it('records a route, creating the file, and lists it back', async () => {
    const port = createNodeRecentRoutes(home);
    expect(await port.record('/repo/a')).toEqual(['/repo/a']);
    expect(await createNodeRecentRoutes(home).list()).toEqual(['/repo/a']);
  });

  it('promotes a repeated route to the front rather than duplicating it', async () => {
    const port = createNodeRecentRoutes(home);
    await port.record('/repo/a');
    await port.record('/repo/b');
    expect(await port.record('/repo/a')).toEqual(['/repo/a', '/repo/b']);
  });

  it('honours an explicit cap, dropping the oldest', async () => {
    const port = createNodeRecentRoutes(home, 2);
    await port.record('/a');
    await port.record('/b');
    expect(await port.record('/c')).toEqual(['/c', '/b']);
  });

  it('removes a route and persists the shrunken list', async () => {
    const port = createNodeRecentRoutes(home);
    await port.record('/repo/a');
    await port.record('/repo/b');
    expect(await port.remove('/repo/a')).toEqual(['/repo/b']);
    expect(await createNodeRecentRoutes(home).list()).toEqual(['/repo/b']);
  });

  it('refuses a relative route at record — the list holds absolute paths only', async () => {
    const port = createNodeRecentRoutes(home);
    await port.record('/repo/a');
    expect(await port.record('.')).toEqual(['/repo/a']);
  });

  it('fails loud when the file is not an array', async () => {
    await writeFile(join(home, 'recent.json'), '{"not":"a list"}', 'utf8');
    await expect(createNodeRecentRoutes(home).list()).rejects.toThrow(/not a list of paths/);
  });

  it('fails loud when an entry is not a string', async () => {
    await writeFile(join(home, 'recent.json'), '["/a", 7]', 'utf8');
    await expect(createNodeRecentRoutes(home).list()).rejects.toThrow(/not a list of paths/);
  });
});
