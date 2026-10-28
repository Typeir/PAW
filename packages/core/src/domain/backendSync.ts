/**
 * PAW Backend Sync Plan
 *
 * @fileoverview Which enabled backend connectors can sync, and through which module. A backend
 * syncs through the module {@link BACKEND_SYNC} names for it; one with no route, or whose module
 * is not enabled, is refused with the verb that fixes it.
 *
 * @module @paw/core/domain/backendSync
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ConfigDocument } from './config.js';
import { enabledConnectorIds, VENDOR_CONNECTORS } from './connectors.js';
import { enabledModuleIds, VENDOR_MODULES, type ModuleEntry } from './modules.js';

/**
 * One route: a backend connector and the module that implements its sync.
 *
 * @interface BackendRoute
 * @property {string} connector - Backend connector id.
 * @property {string} module - Module id exporting `backend`.
 */
export interface BackendRoute {
  readonly connector: string;
  readonly module: string;
}

/**
 * Sync routes this build ships.
 *
 * @constant
 * @type {readonly BackendRoute[]}
 */
export const BACKEND_SYNC: readonly BackendRoute[] = [{ connector: 'openproject', module: 'paw-openproject' }];

/**
 * One planned sync, or why a connector cannot sync.
 */
export type BackendSyncStep =
  | { readonly ok: true; readonly connector: string; readonly module: ModuleEntry }
  | { readonly ok: false; readonly connector: string; readonly reason: string };

/**
 * One connector's sync outcome, as a shell reports it.
 */
export type BackendSyncReport =
  | {
      readonly connector: string;
      readonly ok: true;
      readonly mode: 'full' | 'delta';
      readonly pulled: number;
      readonly removed: number;
      readonly refusals: readonly string[];
    }
  | { readonly connector: string; readonly ok: false; readonly reason: string };

/**
 * Plan a sync of every enabled backend connector.
 *
 * @param {ConfigDocument} config - The config document.
 * @returns {BackendSyncStep[]} One step per enabled backend, catalogue order; empty when none is enabled.
 */
export function backendSyncPlan(config: ConfigDocument): BackendSyncStep[] {
  const connectors = new Set(enabledConnectorIds(config));
  const modules = new Set(enabledModuleIds(config));
  return VENDOR_CONNECTORS.filter((entry) => entry.kind === 'backend' && connectors.has(entry.id)).map(
    ({ id }): BackendSyncStep => {
      const route = BACKEND_SYNC.find((candidate) => candidate.connector === id);
      if (route === undefined) {
        return {
          ok: false,
          connector: id,
          reason: `connector "${id}" has no sync module in this build; disable it with paw connectors disable ${id}`,
        };
      }
      if (!modules.has(route.module)) {
        return {
          ok: false,
          connector: id,
          reason: `connector "${id}" syncs through module ${route.module}; enable it with paw modules enable ${route.module}`,
        };
      }
      return {
        ok: true,
        connector: id,
        module: VENDOR_MODULES.find((entry) => entry.id === route.module) as ModuleEntry,
      };
    },
  );
}
