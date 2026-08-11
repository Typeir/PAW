/**
 * PAW Registry Builder Tests
 *
 * @fileoverview Build registry from bindings, empty case, loud throw when role
 * bound to undeclared model. Exercise `buildRegistry.ts` and `BUILTIN_ROLES`
 * data it use, hit 100%.
 *
 * @module @paw/core/test/application/buildRegistry
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { BUILTIN_ROLES } from '../../src/application/builtinRoles.js';
import { buildRegistry } from '../../src/application/buildRegistry.js';
import type { ModelCapabilities } from '../../src/domain/role.js';
import type { ModelPort } from '../../src/ports/index.js';

const port: ModelPort = {
  complete: async () => ({ content: '', inputTokens: 0, outputTokens: 0 }),
};
const CAP: ModelCapabilities = {
  contextTokens: 128_000,
  maxOutputTokens: 8_192,
  tools: true,
  structuredOutput: true,
  reasoning: false,
  vision: false,
  costClass: 'cheap',
};

describe('buildRegistry', () => {
  it('binds declared roles to their configured models', () => {
    const reg = buildRegistry(
      { models: { 'ds-flash': CAP }, roles: { 'edit.apply': 'ds-flash' } },
      () => port,
    );
    expect(reg.declarations.has('edit.apply')).toBe(true);
    expect(reg.bindings.get('edit.apply')).toMatchObject({ modelId: 'ds-flash' });
  });

  it('declares every built-in role even with no bindings', () => {
    const reg = buildRegistry({}, () => port);
    expect(reg.bindings.size).toBe(0);
    expect(reg.declarations.size).toBe(BUILTIN_ROLES.length);
  });

  it('throws loudly when a role is bound to an undeclared model', () => {
    expect(() =>
      buildRegistry({ roles: { 'edit.apply': 'ghost' } }, () => port),
    ).toThrow(/does not declare/);
  });
});
