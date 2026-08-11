/**
 * PAW role registry tests.
 *
 * @fileoverview Test role resolution and role doctor on every path:
 * unknown role, optional and required unbound, optional and required
 * unsatisfied, happy path. Use fake {@link ModelPort}, never call. Resolution
 * logic hit 100%, no I/O.
 *
 * @module @paw/core/test/application/roleRegistry
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import type {
  ModelCapabilities,
  RoleDeclaration,
} from '../../src/domain/role.js';
import type { ModelPort } from '../../src/ports/index.js';
import {
  doctorRoles,
  resolveModel,
  type ModelBinding,
  type RoleRegistry,
} from '../../src/application/roleRegistry.js';

/**
 * Fake model port. Record nothing, return fixed response. Never invoked in
 * these tests.
 */
const fakePort: ModelPort = {
  complete: async () => ({ content: '', inputTokens: 0, outputTokens: 0 }),
};

const CAP: ModelCapabilities = {
  contextTokens: 128_000,
  maxOutputTokens: 8_192,
  tools: true,
  structuredOutput: true,
  reasoning: true,
  vision: false,
  costClass: 'cheap',
};

/**
 * Build role declaration.
 *
 * @param {string} id - Role id.
 * @param {boolean} optional - Whether role optional.
 * @param {Partial<RoleDeclaration['requires']>} reqOver - Requirement overrides.
 * @returns {RoleDeclaration} Declaration.
 */
const decl = (
  id: string,
  optional: boolean,
  reqOver: Partial<RoleDeclaration['requires']> = {},
): RoleDeclaration => ({
  id,
  owner: 'test',
  purpose: 'test role',
  optional,
  requires: {
    minContextTokens: 32_000,
    maxOutputTokens: 4_096,
    tools: true,
    structuredOutput: false,
    reasoning: false,
    vision: false,
    costClass: 'standard',
    latencyClass: 'batch',
    ...reqOver,
  },
});

/**
 * Assemble registry from declaration and binding entries.
 *
 * @param {RoleDeclaration[]} decls - Declarations.
 * @param {Array<[string, ModelBinding]>} binds - Binding entries.
 * @returns {RoleRegistry} Registry.
 */
const registry = (
  decls: RoleDeclaration[],
  binds: Array<[string, ModelBinding]>,
): RoleRegistry => ({
  declarations: new Map(decls.map((d) => [d.id, d])),
  bindings: new Map(binds),
});

const binding = (over: Partial<ModelBinding> = {}): ModelBinding => ({
  modelId: 'ds-flash',
  capabilities: CAP,
  port: fakePort,
  ...over,
});

describe('resolveModel', () => {
  it('returns a handle for a satisfied binding, carrying the output ceiling', () => {
    const reg = registry([decl('edit.apply', false)], [['edit.apply', binding()]]);
    const handle = resolveModel(reg, 'edit.apply');
    expect(handle).toEqual({
      port: fakePort,
      modelId: 'ds-flash',
      maxOutputTokens: CAP.maxOutputTokens,
    });
  });

  it('throws on an unknown role', () => {
    expect(() => resolveModel(registry([], []), 'nope')).toThrow(/unknown role/);
  });

  it('throws when a required role is unbound', () => {
    const reg = registry([decl('review.judge', false)], []);
    expect(() => resolveModel(reg, 'review.judge')).toThrow(/unbound/);
  });

  it('returns null when an optional role is unbound', () => {
    const reg = registry([decl('memory.draft', true)], []);
    expect(resolveModel(reg, 'memory.draft')).toBeNull();
  });

  it('throws when a required role binding does not satisfy', () => {
    const reg = registry(
      [decl('edit.apply', false, { tools: true })],
      [['edit.apply', binding({ capabilities: { ...CAP, tools: false } })]],
    );
    expect(() => resolveModel(reg, 'edit.apply')).toThrow(/does not satisfy/);
  });

  it('returns null when an optional role binding does not satisfy', () => {
    const reg = registry(
      [decl('memory.draft', true, { tools: true })],
      [['memory.draft', binding({ capabilities: { ...CAP, tools: false } })]],
    );
    expect(resolveModel(reg, 'memory.draft')).toBeNull();
  });
});

describe('doctorRoles', () => {
  it('reports bound, unbound, and unsatisfied rows with correct blocking', () => {
    const reg = registry(
      [
        decl('edit.apply', false),
        decl('review.judge', false),
        decl('memory.draft', true),
        decl('gate.explain', true, { tools: true }),
      ],
      [
        ['edit.apply', binding()],
        ['gate.explain', binding({ capabilities: { ...CAP, tools: false } })],
      ],
    );
    const rows = doctorRoles(reg);

    expect(rows.find((r) => r.role === 'edit.apply')).toMatchObject({
      boundTo: 'ds-flash',
      blocking: false,
    });
    expect(rows.find((r) => r.role === 'review.judge')).toMatchObject({
      boundTo: null,
      blocking: true,
    });
    expect(rows.find((r) => r.role === 'memory.draft')).toMatchObject({
      boundTo: null,
      blocking: false,
    });
    expect(rows.find((r) => r.role === 'gate.explain')).toMatchObject({
      boundTo: 'ds-flash',
      blocking: false,
    });
  });
});
