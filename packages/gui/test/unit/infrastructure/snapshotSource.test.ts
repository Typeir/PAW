/**
 * Snapshot Source Tests
 *
 * @fileoverview Covers both ways the console gets data — a daemon's
 * `/api/state` and a build-injected snapshot — and the loud failure when the
 * daemon answers with anything but success.
 *
 * @module @paw/gui/test/unit/infrastructure/snapshotSource
 */

import { describe, expect, it, vi } from 'vitest';
import {
  authedFetch,
  boot,
  createHttpSource,
  createTreeSource,
  STATE_URL,
  TREE_URL,
  type FetchLike,
  type PawWindow,
} from '../../../src/infrastructure/snapshotSource.js';
import type { AuthWindow } from '../../../src/infrastructure/auth.js';
import { makeSnapshot } from '../../fixtures.js';

/**
 * A window with no credential in its address bar and no storage behind it.
 *
 * @param {string} [hash] - The fragment to boot with.
 * @returns {PawWindow & AuthWindow} The fake window.
 */
const makeWindow = (hash = ''): PawWindow & AuthWindow => ({
  location: { hash, pathname: '/', search: '' },
  history: { replaceState: () => undefined },
});

/**
 * A fetch that answers with a snapshot.
 *
 * @param {unknown} body - The body to answer with.
 * @returns {FetchLike} The fake transport.
 */
function okFetch(body: unknown): FetchLike {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
}

describe('createHttpSource', () => {
  it('reads the daemon state endpoint', async () => {
    const snapshot = makeSnapshot();
    const fetchFn = okFetch(snapshot);
    const source = createHttpSource(fetchFn);
    await expect(source(null)).resolves.toEqual(snapshot);
    expect(fetchFn).toHaveBeenCalledWith(STATE_URL);
  });

  it('reads a custom endpoint', async () => {
    const fetchFn = okFetch(makeSnapshot());
    await createHttpSource(fetchFn, '/elsewhere')(null);
    expect(fetchFn).toHaveBeenCalledWith('/elsewhere');
  });

  it('asks for the selected plan, escaping its path', async () => {
    const fetchFn = okFetch(makeSnapshot());
    await createHttpSource(fetchFn)('plans/spell lore.swarm.mjs');
    expect(fetchFn).toHaveBeenCalledWith('/api/state?plan=plans%2Fspell%20lore.swarm.mjs');
  });

  it('throws when the daemon answers with a failure', async () => {
    const fetchFn: FetchLike = async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    await expect(createHttpSource(fetchFn)(null)).rejects.toThrow('/api/state responded 503');
  });
});

describe('createTreeSource', () => {
  it('reads the whole repository tree', async () => {
    const tree = [{ name: 'a.md', path: 'a.md', isFile: true, children: [] }];
    const fetchFn = okFetch(tree);
    await expect(createTreeSource(fetchFn)()).resolves.toEqual(tree);
    expect(fetchFn).toHaveBeenCalledWith(TREE_URL);
  });

  it('narrows to a directory, escaping the root it is given', async () => {
    const fetchFn = okFetch([]);
    await createTreeSource(fetchFn, 'src/domain')();
    expect(fetchFn).toHaveBeenCalledWith('/api/tree?root=src%2Fdomain');
  });

  it('throws rather than reporting a repository with no files', async () => {
    const fetchFn: FetchLike = async () => ({ ok: false, status: 404, json: async () => ({}) });
    await expect(createTreeSource(fetchFn)()).rejects.toThrow('/api/tree responded 404');
  });
});

describe('authedFetch', () => {
  it('presents the credential on every request', async () => {
    const fetchFn = okFetch({});
    await authedFetch(fetchFn, 'tok-123')('/api/state');
    expect(fetchFn).toHaveBeenCalledWith('/api/state', {
      headers: { authorization: 'Bearer tok-123' },
    });
  });

  it('keeps the caller’s own headers alongside it', async () => {
    const fetchFn = okFetch({});
    await authedFetch(fetchFn, 'tok-123')('/api/state', { headers: { accept: 'application/json' } });
    expect(fetchFn).toHaveBeenCalledWith('/api/state', {
      headers: { accept: 'application/json', authorization: 'Bearer tok-123' },
    });
  });

  it('sends no credential header at all when the tab has none', async () => {
    const fetchFn = okFetch({});
    await authedFetch(fetchFn, null)('/api/state');
    expect(fetchFn).toHaveBeenCalledWith('/api/state');
  });
});

describe('boot', () => {
  it('uses the injected snapshot, polling nothing and browsing nothing', async () => {
    const snapshot = makeSnapshot();
    const win: PawWindow & AuthWindow = { ...makeWindow(), __PAW_DATA__: snapshot };
    const fetchFn = okFetch(makeSnapshot({ planName: 'unused' }));
    const result = await boot(win, fetchFn);
    expect(result.snapshot).toBe(snapshot);
    expect(result.source).toBeNull();
    expect(result.treeSource).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches the daemon and keeps both sources', async () => {
    const snapshot = makeSnapshot({ planName: 'live' });
    const result = await boot(makeWindow(), okFetch(snapshot));
    expect(result.snapshot).toEqual(snapshot);
    expect(result.source).not.toBeNull();
    expect(result.treeSource).not.toBeNull();
    expect(result.token).toBeNull();
  });

  it('adopts the printed credential and presents it on every transport', async () => {
    const fetchFn = okFetch(makeSnapshot());
    const win = makeWindow('#t=boot-token-value');
    const result = await boot(win, fetchFn);

    expect(result.token).toBe('boot-token-value');
    expect(fetchFn).toHaveBeenCalledWith(STATE_URL, {
      headers: { authorization: 'Bearer boot-token-value' },
    });

    await result.treeSource?.();
    expect(fetchFn).toHaveBeenLastCalledWith(TREE_URL, {
      headers: { authorization: 'Bearer boot-token-value' },
    });
  });

  it('adopts nothing from an injected static page', async () => {
    const result = await boot(
      { ...makeWindow('#t=ignored'), __PAW_DATA__: makeSnapshot() },
      okFetch({}),
    );
    expect(result.token).toBeNull();
  });
});
