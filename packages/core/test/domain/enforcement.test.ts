/**
 * @fileoverview Unit tests for the pre-tool-use enforcement decision — the pure
 * heart of PAW. Written test-first: these assertions define the API surface of
 * `decidePreToolUse` before it exists, and every branch of the decision is
 * exercised so the module reaches 100% coverage on its own.
 *
 * @module @paw/core/test/domain/enforcement
 */

import { describe, expect, it } from 'vitest';
import {
  decidePreToolUse,
  type PreToolInput,
  type Violation,
} from '../../src/index.js';

/**
 * Build a violation with sensible defaults; override only what a case cares about.
 *
 * @param over - Fields to override on the default violation.
 */
const V = (over: Partial<Violation> = {}): Violation => ({
  id: 1,
  filePath: 'src/a.ts',
  rule: 'jsdoc',
  message: 'missing jsdoc on export',
  indirectFix: false,
  ...over,
});

/**
 * Build a decision input with a benign default (an edit of a clean file), then
 * override the one axis under test.
 *
 * @param over - Fields to override on the default input.
 */
const input = (over: Partial<PreToolInput> = {}): PreToolInput => ({
  toolName: 'edit',
  targetPaths: ['src/a.ts'],
  envMatch: null,
  exemptTools: new Set(['read_file', 'grep_search']),
  ignoredPaths: new Set<string>(),
  violations: [],
  ...over,
});

describe('decidePreToolUse', () => {
  it('denies any tool that touches a secret, ahead of the exempt-tool check', () => {
    const d = decidePreToolUse(
      input({ toolName: 'read_file', envMatch: '.env.local' }),
    );
    expect(d.kind).toBe('deny');
    if (d.kind === 'deny') expect(d.reason).toContain('.env.local');
  });

  it('allows an exempt read-only tool once secrets are cleared', () => {
    const d = decidePreToolUse(
      input({ toolName: 'grep_search', violations: [V()] }),
    );
    expect(d.kind).toBe('allow');
  });

  it('allows any tool when there are no unresolved violations', () => {
    expect(decidePreToolUse(input({ violations: [] })).kind).toBe('allow');
  });

  it('allows when every targeted path is pawignored', () => {
    const d = decidePreToolUse(
      input({
        targetPaths: ['dist/x.js'],
        ignoredPaths: new Set(['dist/x.js']),
        violations: [V()],
      }),
    );
    expect(d.kind).toBe('allow');
  });

  it('does not treat an empty target list as "all ignored"', () => {
    const d = decidePreToolUse(input({ targetPaths: [], violations: [V()] }));
    expect(d.kind).toBe('deny');
  });

  it('allows editing a file that has a direct violation (the fix path)', () => {
    const d = decidePreToolUse(
      input({
        targetPaths: ['src/a.ts'],
        violations: [V({ filePath: 'src/a.ts' })],
      }),
    );
    expect(d.kind).toBe('allow');
  });

  it('allows with a nudge when every remaining violation is indirect-fix', () => {
    const d = decidePreToolUse(
      input({
        targetPaths: ['src/b.ts'],
        violations: [
          V({ filePath: 'src/a.ts', indirectFix: true, message: 'missing test' }),
        ],
      }),
    );
    expect(d.kind).toBe('allow');
    if (d.kind === 'allow') expect(d.additionalContext).toContain('missing test');
  });

  it('denies a non-fix tool when a direct violation exists elsewhere', () => {
    const d = decidePreToolUse(
      input({
        targetPaths: ['src/b.ts'],
        violations: [
          V({ filePath: 'src/a.ts', message: 'm1' }),
          V({ id: 2, filePath: 'src/c.ts', message: 'm2' }),
        ],
      }),
    );
    expect(d.kind).toBe('deny');
    if (d.kind === 'deny') {
      expect(d.reason).toContain('src/a.ts');
      expect(d.reason).toContain('src/c.ts');
    }
  });

  it('a direct violation among indirect ones still grants the fix path', () => {
    const d = decidePreToolUse(
      input({
        targetPaths: ['src/a.ts'],
        violations: [
          V({ filePath: 'src/a.ts', indirectFix: false }),
          V({ id: 2, filePath: 'src/z.ts', indirectFix: true }),
        ],
      }),
    );
    expect(d.kind).toBe('allow');
  });

  it('a deny lists only directly-violated files, never the indirect ones', () => {
    const d = decidePreToolUse(
      input({
        targetPaths: ['src/b.ts'],
        violations: [
          V({ filePath: 'src/a.ts' }),
          V({ id: 2, filePath: 'src/x.ts', indirectFix: true, message: 'missing test' }),
        ],
      }),
    );
    expect(d.kind).toBe('deny');
    if (d.kind === 'deny') {
      expect(d.reason).toContain('src/a.ts');
      expect(d.reason).not.toContain('src/x.ts');
    }
  });
});
