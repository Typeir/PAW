/**
 * PAW Recent Routes Tests
 *
 * @fileoverview Test recent-routes list. New grab go front. Same repository never appear twice, match case-insensitive, ignore slash direction. List cap, oldest fall off. Blank route change nothing.
 *
 * @module @paw/core/test/domain/recentRoutes
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import {
  RECENT_ROUTES_CAP,
  isAbsoluteRoute,
  promoteRoute,
  removeRoute,
  sameRoute,
} from '../../src/domain/recentRoutes.js';

describe('promoteRoute', () => {
  it('puts a freshly grabbed route at the front', () => {
    expect(promoteRoute(['/a', '/b'], '/c')).toEqual(['/c', '/a', '/b']);
  });

  it('moves an existing route to the front rather than duplicating it', () => {
    expect(promoteRoute(['/a', '/b', '/c'], '/b')).toEqual(['/b', '/a', '/c']);
  });

  it('matches the same repository case-insensitively and across slash direction', () => {
    expect(promoteRoute(['C:\\Repo\\A', '/b'], 'c:/repo/a')).toEqual(['c:/repo/a', '/b']);
  });

  it('keeps at most the cap, dropping the oldest', () => {
    expect(promoteRoute(['/a', '/b', '/c'], '/d', 3)).toEqual(['/d', '/a', '/b']);
  });

  it('defaults to the shared cap when none is given', () => {
    const full = Array.from({ length: RECENT_ROUTES_CAP }, (_, i) => `/r${i}`);
    const next = promoteRoute(full, '/fresh');
    expect(next).toHaveLength(RECENT_ROUTES_CAP);
    expect(next[0]).toBe('/fresh');
    expect(next).not.toContain(`/r${RECENT_ROUTES_CAP - 1}`);
  });

  it('is a no-op for a blank route, so a scope of nothing seeds no entry', () => {
    const list = ['/a', '/b'];
    const next = promoteRoute(list, '   ');
    expect(next).toEqual(['/a', '/b']);
    expect(next).not.toBe(list);
  });

  it('is a no-op for a relative route — only absolute paths enter the list', () => {
    expect(promoteRoute(['/a'], '.')).toEqual(['/a']);
    expect(promoteRoute(['/a'], 'repo/sub')).toEqual(['/a']);
  });
});

describe('isAbsoluteRoute', () => {
  it('accepts POSIX, drive, and UNC absolute paths', () => {
    expect(isAbsoluteRoute('/work/a')).toBe(true);
    expect(isAbsoluteRoute('C:\\Users\\x')).toBe(true);
    expect(isAbsoluteRoute('c:/users/x')).toBe(true);
    expect(isAbsoluteRoute('\\\\share\\repo')).toBe(true);
  });

  it('rejects relative routes', () => {
    expect(isAbsoluteRoute('.')).toBe(false);
    expect(isAbsoluteRoute('repo')).toBe(false);
    expect(isAbsoluteRoute('..\\up')).toBe(false);
    expect(isAbsoluteRoute('')).toBe(false);
  });
});

describe('removeRoute', () => {
  it('drops the route however it was spelled, keeping order', () => {
    expect(removeRoute(['/a', 'C:\\Repo\\A', '/b'], 'c:/repo/a')).toEqual(['/a', '/b']);
  });

  it('is a no-op for an unknown route', () => {
    expect(removeRoute(['/a'], '/zzz')).toEqual(['/a']);
  });
});

describe('sameRoute', () => {
  it('matches the same repository across case and slash direction', () => {
    expect(sameRoute('C:\\Repo\\A', 'c:/repo/a')).toBe(true);
  });

  it('separates different repositories', () => {
    expect(sameRoute('/work/a', '/work/b')).toBe(false);
  });
});
