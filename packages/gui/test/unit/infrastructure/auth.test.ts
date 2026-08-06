/**
 * Credential Adoption Tests
 *
 * @fileoverview How a tab comes to hold the daemon's token and how quickly it
 * stops showing it. The behaviours that matter to review: the fragment is read
 * and then **erased from the address bar**, a reload reuses what the tab already
 * adopted, a tab with no token adopts nothing rather than inventing something,
 * and a storage that refuses to cooperate costs a reload instead of the session.
 *
 * @module @paw/gui/test/unit/infrastructure/auth
 */

import { describe, expect, it, vi } from 'vitest';
import {
  TOKEN_STORAGE_KEY,
  adoptToken,
  tokenFromHash,
  type AuthWindow,
  type TokenStorage,
} from '../../../src/infrastructure/auth.js';

const TOKEN = 'r4nd0m-token-value_0123456789abcdefgh';

/**
 * A window with a scriptable address bar and storage.
 *
 * @param {string} hash - The initial fragment.
 * @param {TokenStorage} [storage] - The storage seam.
 * @returns {AuthWindow & { replaced: string[] }} The fake window.
 */
function makeWindow(
  hash: string,
  storage: TokenStorage | undefined = memoryStorage(),
): AuthWindow & { replaced: string[] } {
  const replaced: string[] = [];
  return {
    location: { hash, pathname: '/', search: '' },
    history: {
      replaceState: (_data: unknown, _unused: string, url: string) => {
        replaced.push(url);
      },
    },
    sessionStorage: storage,
    replaced,
  };
}

/**
 * A working storage.
 *
 * @returns {TokenStorage} The store.
 */
function memoryStorage(): TokenStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('tokenFromHash', () => {
  it('reads the token the daemon printed', () => {
    expect(tokenFromHash(`#t=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`t=${TOKEN}`)).toBe(TOKEN);
  });

  it('reads it beside other fragment parameters', () => {
    expect(tokenFromHash(`#plan=a.swarm.mjs&t=${TOKEN}`)).toBe(TOKEN);
  });

  it('reads nothing from an empty, absent, or unrelated fragment', () => {
    expect(tokenFromHash('')).toBeNull();
    expect(tokenFromHash('#')).toBeNull();
    expect(tokenFromHash('#plan=a.swarm.mjs')).toBeNull();
    expect(tokenFromHash('#t=')).toBeNull();
  });
});

describe('adoptToken', () => {
  it('takes the token and strips it from the address bar', () => {
    const win = makeWindow(`#t=${TOKEN}`);
    expect(adoptToken(win)).toBe(TOKEN);
    expect(win.replaced).toEqual(['/']);
  });

  it('keeps the rest of the address while stripping the credential', () => {
    const win = makeWindow(`#t=${TOKEN}`);
    (win.location as { pathname: string }).pathname = '/index.html';
    (win.location as { search: string }).search = '?debug=1';
    adoptToken(win);
    expect(win.replaced).toEqual(['/index.html?debug=1']);
  });

  it('remembers it for the tab, so a reload needs no URL', () => {
    const storage = memoryStorage();
    adoptToken(makeWindow(`#t=${TOKEN}`, storage));
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBe(TOKEN);

    const reloaded = makeWindow('', storage);
    expect(adoptToken(reloaded)).toBe(TOKEN);
    expect(reloaded.replaced).toEqual([]);
  });

  it('prefers a freshly printed token over the one it already had', () => {
    const storage = memoryStorage();
    storage.setItem(TOKEN_STORAGE_KEY, 'stale-token');
    expect(adoptToken(makeWindow(`#t=${TOKEN}`, storage))).toBe(TOKEN);
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBe(TOKEN);
  });

  it('adopts nothing when the tab was opened without one', () => {
    const win = makeWindow('');
    expect(adoptToken(win)).toBeNull();
    expect(win.replaced).toEqual([]);
  });

  it('survives a storage that refuses to read or write', () => {
    const hostile: TokenStorage = {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {
        throw new Error('storage disabled');
      },
    };
    const fresh = makeWindow(`#t=${TOKEN}`, hostile);
    expect(adoptToken(fresh)).toBe(TOKEN);
    expect(fresh.replaced).toEqual(['/']);
    expect(adoptToken(makeWindow('', hostile))).toBeNull();
  });

  it('survives a context with no storage at all', () => {
    const win = makeWindow(`#t=${TOKEN}`, undefined);
    expect(adoptToken(win)).toBe(TOKEN);
    expect(adoptToken(makeWindow('', undefined))).toBeNull();
  });

  it('never writes the token anywhere but storage', () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const win = makeWindow(`#t=${TOKEN}`, storage);
    adoptToken(win);
    expect(setItem).toHaveBeenCalledOnce();
    expect(win.replaced.join(' ')).not.toContain(TOKEN);
  });
});
