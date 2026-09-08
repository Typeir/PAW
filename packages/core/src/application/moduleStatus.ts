/**
 * PAW Module Status
 *
 * @fileoverview Joins the module roster to what the resolver finds on disk.
 * Enabled and resolved are independent: an enabled module whose package is
 * absent reports `enabled` and not `resolved`.
 *
 * @module @paw/core/application/moduleStatus
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ConfigDocument } from '../domain/config.js';
import { moduleRoster, type ModuleRosterRow } from '../domain/modules.js';
import type { ModuleResolverPort } from '../ports/index.js';

/**
 * One roster row with its resolution.
 *
 * @interface ModuleStatus
 * @property {boolean} resolved - Whether the resolver located the package.
 * @property {string} detail - Where it resolved to, or why it did not.
 */
export interface ModuleStatus extends ModuleRosterRow {
  readonly resolved: boolean;
  readonly detail: string;
}

/**
 * The module roster with each entry resolved.
 *
 * @param {ConfigDocument} config - The config document.
 * @param {ModuleResolverPort} resolver - Package locator.
 * @returns {Promise<ModuleStatus[]>} Roster, catalogue order.
 */
export async function resolveModules(
  config: ConfigDocument,
  resolver: ModuleResolverPort,
): Promise<ModuleStatus[]> {
  return Promise.all(
    moduleRoster(config).map(async (row) => ({
      ...row,
      ...(await resolver.resolve(row.specifier)),
    })),
  );
}
