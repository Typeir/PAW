/**
 * PAW Module Catalogue
 *
 * @fileoverview The module catalogue this build ships, baked in. A module is a
 * federated submodule dependency, located by specifier through
 * `ModuleResolverPort`; a connector declares the modules it requires. Enabled
 * ids live in the config `modules` array.
 *
 * @module @paw/core/domain/modules
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ConfigDocument } from './config.js';
import { VENDOR_CONNECTORS } from './connectors.js';

/**
 * One catalogue entry.
 *
 * @interface ModuleEntry
 * @property {string} id - Stable id, the value stored in config.
 * @property {string} title - Display name.
 * @property {string} description - One line of what the module owns.
 * @property {string} specifier - Package specifier the resolver looks up.
 * @property {string} repository - Where `paw modules install` clones it from.
 * @property {string} ref - Commit, tag, or branch the install checks out.
 */
export interface ModuleEntry {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly specifier: string;
  readonly repository: string;
  readonly ref: string;
}

/**
 * The baked-in module catalogue.
 *
 * @constant
 * @type {readonly ModuleEntry[]}
 */
export const VENDOR_MODULES: readonly ModuleEntry[] = [
  {
    id: 'paw-agile',
    title: 'PAW Agile',
    description:
      'Unopinionated work model: multi-parent task graph, cycles refused at write, rollup deduplicated by identity.',
    specifier: '@paw/agile',
    repository: 'https://github.com/Typeir/paw-agile.git',
    ref: 'main',
  },
];

const KNOWN: ReadonlySet<string> = new Set(VENDOR_MODULES.map((entry) => entry.id));

/**
 * Enabled module ids, unknown and non-string entries dropped.
 *
 * @param {ConfigDocument} config - The config document.
 * @returns {string[]} Enabled ids, catalogue order.
 */
export function enabledModuleIds(config: ConfigDocument): string[] {
  const declared = Array.isArray(config.modules) ? config.modules : [];
  const wanted = new Set(declared.filter((id): id is string => typeof id === 'string'));
  return VENDOR_MODULES.filter((entry) => wanted.has(entry.id)).map((entry) => entry.id);
}

/**
 * Whether the catalogue knows an id.
 *
 * @param {string} id - Module id.
 * @returns {boolean} True for a catalogued module.
 */
export function knownModule(id: string): boolean {
  return KNOWN.has(id);
}

/**
 * Catalogued connectors that require a module.
 *
 * @param {string} moduleId - Module id.
 * @returns {string[]} Connector ids, catalogue order.
 */
export function dependentConnectors(moduleId: string): string[] {
  return VENDOR_CONNECTORS.filter((entry) => entry.requires.includes(moduleId)).map(
    (entry) => entry.id,
  );
}

/**
 * One roster row: a catalogue entry with its enabled state and its dependents.
 *
 * @interface ModuleRosterRow
 * @property {string} id - Stable id.
 * @property {string} title - Display name.
 * @property {string} description - One line of what the module owns.
 * @property {string} specifier - Package specifier the resolver looks up.
 * @property {boolean} enabled - Whether the config enables it.
 * @property {readonly string[]} requiredBy - Connectors that require it.
 */
export interface ModuleRosterRow extends ModuleEntry {
  readonly enabled: boolean;
  readonly requiredBy: readonly string[];
}

/**
 * The catalogue with per-config enabled state, for every surface.
 *
 * @param {ConfigDocument} config - The config document.
 * @returns {ModuleRosterRow[]} Roster, catalogue order.
 */
export function moduleRoster(config: ConfigDocument): ModuleRosterRow[] {
  const enabled = new Set(enabledModuleIds(config));
  return VENDOR_MODULES.map((entry) => ({
    ...entry,
    enabled: enabled.has(entry.id),
    requiredBy: dependentConnectors(entry.id),
  }));
}
