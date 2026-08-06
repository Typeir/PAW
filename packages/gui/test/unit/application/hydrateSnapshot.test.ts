/**
 * Hydration Tests
 *
 * @fileoverview Proves the wire-to-console mapping is complete, and that the
 * boundary refuses a snapshot whose member count disagrees with the per-member
 * arrays it shipped rather than rendering a console that quietly omits members.
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
