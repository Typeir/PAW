/**
 * Module Catalogue Tests
 *
 * @fileoverview Cover the baked-in module catalogue, enabled-state resolution
 * over a config document, the dependent-connector edge, the roster rows, the
 * enable/disable config edits, and the join to a resolver.
 *
 * @module @paw/core/test/domain/modules
 */

import { describe, expect, it } from 'vitest';
import {
  VENDOR_MODULES,
  dependentConnectors,
  enabledModuleIds,
  knownModule,
  moduleRoster,
} from '../../src/domain/modules.js';
import { disableModule, enableModule } from '../../src/application/configBinding.js';
import { resolveModules } from '../../src/application/moduleStatus.js';
import type { ModuleResolverPort } from '../../src/ports/index.js';

describe('the vendor catalogue', () => {
  it('ships paw-agile under the @paw/agile specifier', () => {
    expect(VENDOR_MODULES.map((m) => [m.id, m.specifier])).toEqual([['paw-agile', '@paw/agile']]);
    expect(knownModule('paw-agile')).toBe(true);
    expect(knownModule('paw-billing')).toBe(false);
  });
});

describe('enabledModuleIds', () => {
  it('reads enabled ids in catalogue order, dropping unknown and non-string entries', () => {
    expect(enabledModuleIds({ modules: ['paw-agile', 'paw-billing', 7] })).toEqual(['paw-agile']);
    expect(enabledModuleIds({})).toEqual([]);
    expect(enabledModuleIds({ modules: 'paw-agile' })).toEqual([]);
  });
});

describe('dependentConnectors', () => {
  it('names the connectors a module carries', () => {
    expect(dependentConnectors('paw-agile')).toEqual(['taiga', 'rally']);
    expect(dependentConnectors('paw-billing')).toEqual([]);
  });
});

describe('moduleRoster', () => {
  it('marks enabled entries and reports their dependents', () => {
    const [row] = moduleRoster({ modules: ['paw-agile'] });
    expect(row).toMatchObject({ id: 'paw-agile', enabled: true, requiredBy: ['taiga', 'rally'] });
    expect(moduleRoster({})[0]?.enabled).toBe(false);
  });
});

describe('enableModule / disableModule', () => {
  it('enables idempotently and refuses unknown ids naming the catalogue', () => {
    const first = enableModule({}, 'paw-agile');
    expect(first).toMatchObject({ ok: true, config: { modules: ['paw-agile'] } });
    const again = enableModule(first.ok ? first.config : {}, 'paw-agile');
    expect(again).toMatchObject({ ok: true, config: { modules: ['paw-agile'] } });

    const bad = enableModule({}, 'paw-billing');
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.reason).toContain('paw-agile');
  });

  it('disables an enabled module and no-ops an absent one, keeping other fields', () => {
    const off = disableModule({ modules: ['paw-agile'], roles: { a: 'b' } }, 'paw-agile');
    expect(off).toMatchObject({ ok: true, config: { modules: [], roles: { a: 'b' } } });
    expect(disableModule({}, 'paw-agile')).toMatchObject({ ok: true, config: { modules: [] } });
  });

  it('refuses to disable a module an enabled connector requires, naming the connectors', () => {
    const refused = disableModule({ modules: ['paw-agile'], connectors: ['taiga', 'rally'] }, 'paw-agile');
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.reason).toBe(
      'module "paw-agile" is required by enabled connectors: taiga, rally; disable them first',
    );
  });

  it('allows disabling once the connectors are off', () => {
    const off = disableModule({ modules: ['paw-agile'], connectors: ['tsc'] }, 'paw-agile');
    expect(off).toMatchObject({ ok: true, config: { modules: [] } });
  });
});

describe('resolveModules', () => {
  it('reports enabled and resolved as separate facts', async () => {
    const found: ModuleResolverPort = {
      resolve: async (specifier) => ({ resolved: true, detail: `/node_modules/${specifier}` }),
    };
    const [row] = await resolveModules({ modules: ['paw-agile'] }, found);
    expect(row).toMatchObject({
      id: 'paw-agile',
      enabled: true,
      resolved: true,
      detail: '/node_modules/@paw/agile',
    });
  });

  it('carries the resolver reason for a module it cannot find', async () => {
    const absent: ModuleResolverPort = {
      resolve: async () => ({ resolved: false, detail: 'not installed' }),
    };
    const [row] = await resolveModules({ modules: ['paw-agile'] }, absent);
    expect(row).toMatchObject({ enabled: true, resolved: false, detail: 'not installed' });
  });
});
