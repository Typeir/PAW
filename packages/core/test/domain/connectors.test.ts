/**
 * Connector Catalogue Tests
 *
 * @fileoverview Cover the baked-in catalogue, enabled-state resolution over a
 * config document (unknown and non-string entries dropped), the roster rows,
 * and the enable/disable config edits: unknown ids refused, enabling
 * idempotent, disabling absent ids a no-op.
 *
 * @module @paw/core/test/domain/connectors
 */

import { describe, expect, it } from 'vitest';
import {
  VENDOR_CONNECTORS,
  connectorRoster,
  enabledConnectorIds,
  knownConnector,
} from '../../src/domain/connectors.js';
import { disableConnector, enableConnector } from '../../src/application/configBinding.js';

describe('the vendor catalogue', () => {
  it('ships copilot-hooks as host, tsc and eslint as linters', () => {
    expect(VENDOR_CONNECTORS.map((c) => [c.id, c.kind])).toEqual([
      ['copilot-hooks', 'host'],
      ['tsc', 'linter'],
      ['eslint', 'linter'],
    ]);
    expect(knownConnector('tsc')).toBe(true);
    expect(knownConnector('jenkins')).toBe(false);
  });
});

describe('enabledConnectorIds', () => {
  it('reads enabled ids in catalogue order, dropping unknown and non-string entries', () => {
    expect(enabledConnectorIds({ connectors: ['eslint', 'tsc', 'jenkins', 7] })).toEqual([
      'tsc',
      'eslint',
    ]);
    expect(enabledConnectorIds({})).toEqual([]);
    expect(enabledConnectorIds({ connectors: 'tsc' })).toEqual([]);
  });
});

describe('connectorRoster', () => {
  it('marks enabled entries against the config', () => {
    const roster = connectorRoster({ connectors: ['tsc'] });
    expect(roster.find((r) => r.id === 'tsc')?.enabled).toBe(true);
    expect(roster.find((r) => r.id === 'eslint')?.enabled).toBe(false);
    expect(roster).toHaveLength(VENDOR_CONNECTORS.length);
  });
});

describe('enableConnector / disableConnector', () => {
  it('enables idempotently and refuses unknown ids naming the catalogue', () => {
    const first = enableConnector({}, 'tsc');
    expect(first).toMatchObject({ ok: true, config: { connectors: ['tsc'] } });
    const again = enableConnector(first.ok ? first.config : {}, 'tsc');
    expect(again).toMatchObject({ ok: true, config: { connectors: ['tsc'] } });
    const bad = enableConnector({}, 'jenkins');
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.reason).toContain('copilot-hooks');
  });

  it('disables an enabled id and no-ops an absent one, keeping other fields', () => {
    const off = disableConnector({ connectors: ['tsc', 'eslint'], roles: { a: 'b' } }, 'tsc');
    expect(off).toMatchObject({ ok: true, config: { connectors: ['eslint'], roles: { a: 'b' } } });
    expect(disableConnector({}, 'tsc')).toMatchObject({ ok: true, config: { connectors: [] } });
  });
});
