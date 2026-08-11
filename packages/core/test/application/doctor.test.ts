/**
 * PAW Doctor Service Tests
 *
 * @fileoverview Test combined verdict. Clean install, config problem, blocking
 * role, both at once. Cover `doctor.ts` to 100%.
 *
 * @module @paw/core/test/application/doctor
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import type { ModelCapabilities, RoleDeclaration } from '../../src/domain/role.js';
import type { ModelPort } from '../../src/ports/index.js';
import type { RoleRegistry } from '../../src/application/roleRegistry.js';
import { runDoctor } from '../../src/application/doctor.js';

const KNOWN = ['copilot-hooks'];
const port: ModelPort = { complete: async () => ({ content: '', inputTokens: 0, outputTokens: 0 }) };
const CAP: ModelCapabilities = {
  contextTokens: 128_000,
  maxOutputTokens: 8_192,
  tools: true,
  structuredOutput: true,
  reasoning: true,
  vision: false,
  costClass: 'cheap',
};

const role = (id: string, optional: boolean): RoleDeclaration => ({
  id,
  owner: 'test',
  purpose: 'p',
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
  },
});

const goodConfig = { root: '.paw', gatesDir: '.paw/gates', connector: 'copilot-hooks' };
const boundRegistry: RoleRegistry = {
  declarations: new Map([['edit.apply', role('edit.apply', false)]]),
  bindings: new Map([['edit.apply', { modelId: 'm', capabilities: CAP, port }]]),
};

describe('runDoctor', () => {
  it('is ok when the config is sound and all required roles are satisfied', () => {
    const rep = runDoctor(goodConfig, boundRegistry, KNOWN);
    expect(rep.ok).toBe(true);
    expect(rep.config).toEqual([]);
    expect(rep.roles).toHaveLength(1);
  });

  it('is not ok when the config has a problem', () => {
    const rep = runDoctor({ ...goodConfig, connector: 'mystery' }, boundRegistry, KNOWN);
    expect(rep.ok).toBe(false);
    expect(rep.config[0].field).toBe('connector');
  });

  it('is not ok when a required role is blocking', () => {
    const reg: RoleRegistry = {
      declarations: new Map([['review.judge', role('review.judge', false)]]),
      bindings: new Map(),
    };
    const rep = runDoctor(goodConfig, reg, KNOWN);
    expect(rep.ok).toBe(false);
    expect(rep.roles[0].blocking).toBe(true);
  });

  it('reports both a config problem and a role problem together', () => {
    const reg: RoleRegistry = {
      declarations: new Map([['review.judge', role('review.judge', false)]]),
      bindings: new Map(),
    };
    const rep = runDoctor({}, reg, KNOWN);
    expect(rep.ok).toBe(false);
    expect(rep.config.length).toBeGreaterThan(0);
    expect(rep.roles[0].blocking).toBe(true);
  });
});
