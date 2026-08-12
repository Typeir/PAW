/**
 * Hydration Tests
 *
 * @fileoverview Prove wire-to-console mapping complete. hydrate rejects a
 * snapshot whose declared member count does not match the length of
 * per-member arrays. No member is silently omitted from the console.
 *
 * @module @paw/gui/test/unit/application/hydrateSnapshot
 */

import { describe, expect, it } from 'vitest';
import { hydrate } from '../../../src/application/hydrateSnapshot.js';
import { makeSnapshot } from '../../fixtures.js';

describe('hydrate', () => {
  it('maps every field of the wire snapshot into the console', () => {
    const snapshot = makeSnapshot();
    const data = hydrate(snapshot);
    expect(data).toEqual({
      host: snapshot.host,
      processes: snapshot.processes,
      root: snapshot.root,
      configPath: '.paw/config.json',
      plans: snapshot.plans,
      selectedPlan: 'plans/demo.swarm.mjs',
      plan: {
        name: 'demo',
        role: 'lore.author',
        total: 4,
        source: snapshot.planSource,
        highlightLine: 1,
        briefs: snapshot.briefs,
        slugs: snapshot.slugs,
      },
      doctor: snapshot.doctor,
      checks: snapshot.planFindings,
      run: snapshot.run,
      budget: snapshot.budget,
      violations: snapshot.violations,
      logs: snapshot.logs,
      daemon: snapshot.daemon,
      chrome: snapshot.chrome,
    });
  });

  it('rejects a snapshot with too few briefs', () => {
    expect(() => hydrate(makeSnapshot({ briefs: ['one'] }))).toThrow(
      'declares 4 members but sent 1 briefs',
    );
  });

  it('rejects a snapshot with too few slugs', () => {
    expect(() => hydrate(makeSnapshot({ slugs: [] }))).toThrow(
      'declares 4 members but sent 0 slugs',
    );
  });
});
