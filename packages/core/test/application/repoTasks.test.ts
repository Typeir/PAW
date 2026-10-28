/**
 * Repository Task View Tests
 *
 * @fileoverview Cover {@link repoTaskView}: rows become list rows, every enabled backend reports
 * its freshness from the sync log, and a log that does not parse joins the refusals.
 *
 * @module @paw/core/test/application/repoTasks
 */

import { describe, expect, it } from 'vitest';
import { repoTaskView } from '../../src/application/repoTasks.js';

const row = {
  id: 'op-1',
  title: 'Epic',
  parents: [],
  children: [],
  depth: 0,
  rollup: 0,
  orphan: false,
  fields: { url: 'https://tracker.test/work_packages/1' },
};

const view = { rows: [row], refusals: ['an edge is not a [parent, child] pair of strings'], loops: [], dangling: [] };

const config = { connectors: ['openproject'], modules: ['paw-agile', 'paw-openproject'] };

describe('repoTaskView', () => {
  it('lists rows with links and each enabled backend with its last sync', () => {
    const report = { connector: 'openproject', ok: true, mode: 'full', pulled: 1, removed: 0, refusals: [] };
    const syncLog = JSON.stringify({ openproject: { at: '2026-10-28T15:00:00.000Z', report } });
    expect(repoTaskView({ enabled: true, view, config, syncLog })).toEqual({
      enabled: true,
      rows: [
        {
          id: 'op-1',
          title: 'Epic',
          parents: [],
          children: [],
          depth: 0,
          rollup: 0,
          orphan: false,
          link: 'https://tracker.test/work_packages/1',
        },
      ],
      refusals: ['an edge is not a [parent, child] pair of strings'],
      loops: [],
      dangling: [],
      backends: [
        { connector: 'openproject', ready: true, reason: null, last: { at: '2026-10-28T15:00:00.000Z', report } },
      ],
    });
  });

  it('adds a log that does not parse to the refusals and reports no last sync', () => {
    const shown = repoTaskView({ enabled: false, view, config, syncLog: '{' });
    expect(shown.enabled).toBe(false);
    expect(shown.refusals).toHaveLength(2);
    expect(shown.refusals[1]).toMatch(/^\.paw\/backend-sync\.json is not valid JSON: /);
    expect(shown.backends).toEqual([{ connector: 'openproject', ready: true, reason: null, last: null }]);
  });
});
