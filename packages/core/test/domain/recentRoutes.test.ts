/**
 * PAW Recent Routes Tests
 *
 * @fileoverview The recent-routes list operation: a grab goes to the front, the
 * same repository never appears twice (matched case-insensitively and regardless
 * of slash direction, so a Windows path typed two ways is one entry), the list is
 * capped with the oldest falling off, and a blank route changes nothing. So
 * `recentRoutes.ts` reaches 100%.
 *
 * @module @paw/core/test/domain/recentRoutes
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { RECENT_ROUTES_CAP, promoteRoute } from '../../src/domain/recentRoutes.js';

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
});
