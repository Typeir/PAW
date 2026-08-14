/**
 * PAW Connector Catalogue
 *
 * @fileoverview The connector catalogue this build ships, baked in; there is
 * no vendor endpoint. A `host` connector bridges editor-agent hooks into the
 * loop; a `linter` runs a tool during enforcement and records deferred
 * violations. Enabled ids live in the config `connectors` array.
 *
 * @module @paw/core/domain/connectors
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ConfigDocument } from './config.js';

/**
 * What a connector is to the loop.
 */
export type ConnectorKind = 'host' | 'linter';

/**
 * One catalogue entry.
 *
 * @interface ConnectorEntry
 * @property {string} id - Stable id, the value stored in config.
 * @property {ConnectorKind} kind - Host bridge or linter.
 * @property {string} title - Display name.
 * @property {string} description - One line of what enabling does.
 */
export interface ConnectorEntry {
  readonly id: string;
  readonly kind: ConnectorKind;
  readonly title: string;
  readonly description: string;
}

/**
 * The baked-in vendor catalogue.
 *
 * @constant
 * @type {readonly ConnectorEntry[]}
 */
export const VENDOR_CONNECTORS: readonly ConnectorEntry[] = [
  {
    id: 'copilot-hooks',
    kind: 'host',
    title: 'Copilot agent hooks',
    description: 'Bridges Copilot editor-agent hook events into the enforcement loop.',
  },
  {
    id: 'tsc',
    kind: 'linter',
    title: 'TypeScript compiler',
    description: 'Type errors on touched files become deferred violations.',
  },
  {
    id: 'eslint',
    kind: 'linter',
    title: 'ESLint',
    description: 'Lint findings on touched files become deferred violations.',
  },
];

const KNOWN: ReadonlySet<string> = new Set(VENDOR_CONNECTORS.map((entry) => entry.id));

/**
 * Enabled connector ids, unknown and non-string entries dropped. The legacy
 * singular `connector` field counts as enabling that id — a repo predating
 * this catalogue still runs that host bridge.
 *
 * @param {ConfigDocument} config - The config document.
 * @returns {string[]} Enabled ids, catalogue order.
 */
export function enabledConnectorIds(config: ConfigDocument): string[] {
  const declared = Array.isArray(config.connectors) ? config.connectors : [];
  const wanted = new Set(declared.filter((id): id is string => typeof id === 'string'));
  if (typeof config.connector === 'string') {
    wanted.add(config.connector);
  }
  return VENDOR_CONNECTORS.filter((entry) => wanted.has(entry.id)).map((entry) => entry.id);
}

/**
 * One roster row: a catalogue entry with its enabled state.
 *
 * @interface ConnectorRosterRow
 * @property {string} id - Stable id.
 * @property {ConnectorKind} kind - Host bridge or linter.
 * @property {string} title - Display name.
 * @property {string} description - One line of what enabling does.
 * @property {boolean} enabled - Whether the config enables it.
 */
export interface ConnectorRosterRow extends ConnectorEntry {
  readonly enabled: boolean;
}

/**
 * The catalogue with per-config enabled state, for every surface.
 *
 * @param {ConfigDocument} config - The config document.
 * @returns {ConnectorRosterRow[]} Roster, catalogue order.
 */
export function connectorRoster(config: ConfigDocument): ConnectorRosterRow[] {
  const enabled = new Set(enabledConnectorIds(config));
  return VENDOR_CONNECTORS.map((entry) => ({ ...entry, enabled: enabled.has(entry.id) }));
}

/**
 * Whether the catalogue knows an id.
 *
 * @param {string} id - Connector id.
 * @returns {boolean} True for a catalogued connector.
 */
export function knownConnector(id: string): boolean {
  return KNOWN.has(id);
}
