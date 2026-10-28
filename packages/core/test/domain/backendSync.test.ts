/**
 * Backend Sync Plan Tests
 *
 * @fileoverview Cover {@link backendSyncPlan}: only enabled backend connectors are planned, in
 * catalogue order; one with a sync module that is enabled resolves to that catalogue entry; one
 * without a sync module, or whose module is off, is refused with the verb that fixes it.
 *
 * @module @paw/core/test/domain/backendSync
 */

import { describe, expect, it } from 'vitest';
import {
  BACKEND_SYNC,
  SYNC_LOG_FILE,
  backendFreshness,
  freshnessText,
  backendSyncPlan,
  parseSyncLog,
  recordSyncs,
} from '../../src/domain/backendSync.js';
import { VENDOR_MODULES } from '../../src/domain/modules.js';

describe('BACKEND_SYNC', () => {
  it('routes openproject through paw-openproject and nothing else', () => {
    expect(BACKEND_SYNC).toEqual([{ connector: 'openproject', module: 'paw-openproject' }]);
  });
});

describe('backendSyncPlan', () => {
  it('plans nothing when no backend connector is enabled', () => {
    expect(backendSyncPlan({ connectors: ['tsc', 'claude-hooks'], modules: ['paw-agile'] })).toEqual([]);
  });

  it('resolves an enabled backend to its enabled sync module', () => {
    expect(
      backendSyncPlan({ connectors: ['openproject'], modules: ['paw-agile', 'paw-openproject'] }),
    ).toEqual([
      {
        ok: true,
        connector: 'openproject',
        module: VENDOR_MODULES.find((entry) => entry.id === 'paw-openproject'),
      },
    ]);
  });

  it('refuses a backend whose sync module is off, and one with no sync module, in catalogue order', () => {
    expect(backendSyncPlan({ connectors: ['openproject', 'rally'], modules: ['paw-agile'] })).toEqual([
      {
        ok: false,
        connector: 'rally',
        reason: 'connector "rally" has no sync module in this build; disable it with paw connectors disable rally',
      },
      {
        ok: false,
        connector: 'openproject',
        reason:
          'connector "openproject" syncs through module paw-openproject; enable it with paw modules enable paw-openproject',
      },
    ]);
  });
});

describe('parseSyncLog / recordSyncs', () => {
  const synced = { connector: 'openproject', ok: true as const, mode: 'delta' as const, pulled: 1, removed: 0, refusals: [] };
  const refused = { connector: 'rally', ok: false as const, reason: 'connector "rally" has no sync module in this build' };

  it('reads a blank log as no syncs, and names the file', () => {
    expect(parseSyncLog('\n')).toEqual({ ok: true, last: {} });
    expect(SYNC_LOG_FILE).toBe('.paw/backend-sync.json');
  });

  it('records the newest report per connector with its time, keeping the others', () => {
    const first = recordSyncs({}, [synced, refused], '2026-10-28T15:00:00.000Z');
    const parsed = parseSyncLog(first);
    expect(parsed).toEqual({
      ok: true,
      last: {
        openproject: { at: '2026-10-28T15:00:00.000Z', report: synced },
        rally: { at: '2026-10-28T15:00:00.000Z', report: refused },
      },
    });
    const second = recordSyncs(parsed.ok ? parsed.last : {}, [{ ...synced, pulled: 4 }], '2026-10-28T16:00:00.000Z');
    expect(second.endsWith('}\n')).toBe(true);
    expect(parseSyncLog(second)).toMatchObject({
      ok: true,
      last: {
        openproject: { at: '2026-10-28T16:00:00.000Z', report: { pulled: 4 } },
        rally: { at: '2026-10-28T15:00:00.000Z' },
      },
    });
  });

  it('refuses a log that is not JSON or holds a malformed entry, naming the fix', () => {
    const parsed = parseSyncLog('{');
    expect(!parsed.ok && parsed.reason).toMatch(/^\.paw\/backend-sync\.json is not valid JSON: /);
    for (const text of ['[]', '{"openproject":7}', '{"openproject":{"at":1,"report":{}}}', '{"openproject":{"at":"t","report":null}}', '{"openproject":{"at":"t","report":{"ok":"yes","connector":"openproject"}}}']) {
      expect(parseSyncLog(text)).toEqual({
        ok: false,
        reason: `${SYNC_LOG_FILE} holds an entry that is not a sync record; delete it and sync again`,
      });
    }
  });
});

describe('backendFreshness', () => {
  const at = '2026-10-28T15:00:00.000Z';
  const report = { connector: 'openproject', ok: true as const, mode: 'full' as const, pulled: 5, removed: 0, refusals: [] };

  it('lists every enabled backend with whether it can sync and its last sync', () => {
    expect(
      backendFreshness(
        { connectors: ['openproject', 'rally', 'tsc'], modules: ['paw-agile', 'paw-openproject'] },
        { openproject: { at, report } },
      ),
    ).toEqual([
      {
        connector: 'rally',
        ready: false,
        reason: 'connector "rally" has no sync module in this build; disable it with paw connectors disable rally',
        last: null,
      },
      { connector: 'openproject', ready: true, reason: null, last: { at, report } },
    ]);
  });
});

describe('freshnessText', () => {
  const at = '2026-10-28T16:05:09.123Z';
  const base = { connector: 'openproject', ready: true, reason: null };

  it('says when and how the last sync ran, and what it skipped', () => {
    const report = { connector: 'openproject', ok: true as const, mode: 'delta' as const, pulled: 2, removed: 1, refusals: ['x'] };
    expect(freshnessText({ ...base, last: { at, report } })).toBe(
      'synced 2026-10-28 16:05 UTC · delta · 2 pulled, 1 removed · 1 skipped',
    );
    expect(freshnessText({ ...base, last: { at, report: { ...report, refusals: [] } } })).toBe(
      'synced 2026-10-28 16:05 UTC · delta · 2 pulled, 1 removed',
    );
  });

  it('says never synced, the last refusal, or why it cannot sync', () => {
    expect(freshnessText({ ...base, last: null })).toBe('never synced');
    const refused = { connector: 'openproject', ok: false as const, reason: 'GET /x page 1 returned 401: no' };
    expect(freshnessText({ ...base, last: { at, report: refused } })).toBe(
      'last sync refused 2026-10-28 16:05 UTC: GET /x page 1 returned 401: no',
    );
    expect(freshnessText({ connector: 'rally', ready: false, reason: 'no sync module', last: null })).toBe(
      'cannot sync: no sync module',
    );
  });
});
