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
import { BACKEND_SYNC, backendSyncPlan } from '../../src/domain/backendSync.js';
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
