/**
 * PAW Role Registry Tests
 *
 * @fileoverview Covers role resolution and the role doctor across every path —
 * unknown role, optional and required unbound, optional and required
 * unsatisfied, and the happy path — using a fake {@link ModelPort} that is never
 * actually called, so the resolution logic reaches 100% with no I/O.
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
 * A fake model port that records nothing and returns a fixed response. It exists
 * only to prove the registry hands back a port; it is never invoked in these
 * tests.
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
 * Build a role declaration.
 *
 * @param {string} id - Role id.
 * @param {boolean} optional - Whether the role is optional.
 * @param {Partial<RoleDeclaration['requires']>} reqOver - Requirement overrides.
 * @returns {RoleDeclaration} A declaration.
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
 * Assemble a registry from declaration and binding entries.
 *
 * @param {RoleDeclaration[]} decls - Declarations.
 * @param {Array<[string, ModelBinding]>} binds - Binding entries.
 * @returns {RoleRegistry} A registry.
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
  it('returns a handle for a satisfied binding', () => {
    const reg = registry([decl('edit.apply', false)], [['edit.apply', binding()]]);
    expect(resolveModel(reg, 'edit.apply')).toEqual({ port: fakePort, modelId: 'ds-flash' });
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
