/**
 * PAW Check-Tool Use-Case Tests
 *
 * @fileoverview Drives the use-case against a fake {@link StorePort} to confirm
 * it fetches the session's violations and returns the decision they imply — no
 * database involved.
 *
 * @module @paw/core/test/application/checkTool
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import type { Violation } from '../../src/domain/violation.js';
import type { StorePort } from '../../src/ports/index.js';
import {
  checkTool,
  type CheckToolRequest,
} from '../../src/application/checkTool.js';

/**
 * A store that returns a fixed violation list and records the session it was
 * asked about.
 *
 * @param {Violation[]} violations - What `unresolvedFor` returns.
 * @returns {StorePort & { asked: (string | null)[] }} The fake store.
 */
const fakeStore = (
  violations: Violation[],
): StorePort & { asked: (string | null)[] } => {
  const asked: (string | null)[] = [];
  return {
    asked,
    unresolvedFor: async (sessionId) => {
      asked.push(sessionId);
      return violations;
    },
    raise: async () => undefined,
    resolveForFile: async () => 0,
    outstanding: async () => violations,
    prune: async () => 0,
  };
};

const req = (over: Partial<CheckToolRequest> = {}): CheckToolRequest => ({
  sessionId: 'sess-1',
  toolName: 'edit',
  targetPaths: ['src/b.ts'],
  envMatch: null,
  exemptTools: new Set(['read_file']),
  ignoredPaths: new Set<string>(),
  ...over,
});

describe('checkTool', () => {
  it('allows when the store reports no violations, querying the right session', async () => {
    const store = fakeStore([]);
    const d = await checkTool(store, req());
    expect(d.kind).toBe('allow');
    expect(store.asked).toEqual(['sess-1']);
  });

  it('denies when the store reports a blocking violation elsewhere', async () => {
    const store = fakeStore([
      { id: 1, filePath: 'src/a.ts', rule: 'jsdoc', message: 'missing', indirectFix: false },
    ]);
    const d = await checkTool(store, req({ targetPaths: ['src/b.ts'] }));
    expect(d.kind).toBe('deny');
    if (d.kind === 'deny') expect(d.reason).toContain('src/a.ts');
  });
});
