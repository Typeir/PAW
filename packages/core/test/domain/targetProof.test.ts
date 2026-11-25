/**
 * PAW Target Proof Tests
 *
 * @fileoverview Every target and member state, plus the parent-directory split
 * a bare filename hits. Covers `targetProof.ts` to 100%.
 *
 * @module @paw/core/test/domain/targetProof
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import {
  judgeViolations,
  parentDir,
  proofFailures,
  proveMember,
  proveTarget,
  unprovedMembers,
  type TargetProof,
} from '../../src/domain/targetProof.js';
import type { Violation } from '../../src/domain/violation.js';

const written: TargetProof = { path: 'a.md', state: 'written' };
const empty: TargetProof = { path: 'b.md', state: 'empty' };

describe('parentDir', () => {
  it('splits a nested path', () => {
    expect(parentDir('.ignore/swarms/findings/one.md')).toBe('.ignore/swarms/findings');
  });

  it('gives an empty string for a bare filename', () => {
    expect(parentDir('one.md')).toBe('');
  });
});

describe('proveTarget', () => {
  it('trusts a path PAW wrote itself', () => {
    expect(proveTarget('a.md', 'same', 'same', true)).toEqual(written);
  });

  it('calls an empty file empty — the placeholder was never filled', () => {
    expect(proveTarget('b.md', '', '', false)).toEqual(empty);
  });

  it('calls byte-identical content unchanged', () => {
    expect(proveTarget('c.md', 'old', 'old', false)).toEqual({
      path: 'c.md',
      state: 'unchanged',
    });
  });

  it('calls new content written', () => {
    expect(proveTarget('c.md', 'old', 'new', false)).toEqual({
      path: 'c.md',
      state: 'written',
    });
  });
});

describe('proveMember', () => {
  it('reports a member that never ran as skipped, dropping its targets', () => {
    expect(proveMember(0, 'k', false, [empty])).toEqual({
      member: 0,
      key: 'k',
      state: 'skipped',
      targets: [],
      violations: [],
    });
  });

  it('reports a member with no declared files as undeclared', () => {
    expect(proveMember(1, 'k', true, [])).toMatchObject({ state: 'undeclared' });
  });

  it('proves a member whose every file was written', () => {
    expect(proveMember(2, 'k', true, [written, { ...written, path: 'z.md' }])).toMatchObject({
      state: 'proved',
    });
  });

  it('unproves a member with one unwritten file', () => {
    expect(proveMember(3, 'k', true, [written, empty])).toMatchObject({
      state: 'unproved',
    });
  });
});

describe('unprovedMembers', () => {
  it('keeps only the members that ran and produced nothing', () => {
    const proofs = [
      proveMember(0, 'a', true, [written]),
      proveMember(1, 'b', true, [empty]),
      proveMember(2, 'c', false, []),
      proveMember(3, 'd', true, []),
    ];
    expect(unprovedMembers(proofs).map((p) => p.key)).toEqual(['b']);
  });
});

describe('judgeViolations', () => {
  const v = (id: number, filePath: string, rule: string): Violation => ({
    id,
    filePath,
    rule,
    message: rule,
    indirectFix: false,
  });
  const cart = { path: './src/cart.ts', state: 'written' as const };

  it('marks a proved member violating when its declared file holds open violations', () => {
    const proofs = [proveMember(0, 'cart', true, [cart]), proveMember(1, 'orders', true, [written])];
    const open = [
      v(1, 'src/cart.ts', 'no-console'),
      v(2, 'src\\cart.ts', 'no-console'),
      v(3, 'x.ts', 'r'),
    ];
    const [judged, clean] = judgeViolations(proofs, open);

    expect(judged.state).toBe('violating');
    expect(judged.violations.map((x) => x.id)).toEqual([1, 2]);
    expect(clean).toBe(proofs[1]);
  });

  it('leaves unproved, undeclared, and skipped members as they were', () => {
    const proofs = [
      proveMember(0, 'a', true, [empty]),
      proveMember(1, 'b', true, []),
      proveMember(2, 'c', false, []),
    ];
    expect(judgeViolations(proofs, [v(1, 'b.md', 'r')])).toEqual(proofs);
  });
});

describe('proofFailures', () => {
  it('names each unproduced file with its reason', () => {
    const proof = proveMember(0, 'k', true, [
      written,
      empty,
      { path: 'c.md', state: 'unchanged' },
    ]);
    expect(proofFailures(proof)).toEqual([
      'declared file is empty: b.md',
      'declared file is unchanged: c.md',
    ]);
  });

  it('counts open violations per file and names their distinct rules', () => {
    const proof = judgeViolations(
      [proveMember(0, 'k', true, [{ path: 'src/cart.ts', state: 'written' }])],
      [
        { id: 1, filePath: 'src/cart.ts', rule: 'no-console', message: 'm', indirectFix: false },
        { id: 2, filePath: 'src/cart.ts', rule: 'no-console', message: 'm', indirectFix: false },
        { id: 3, filePath: 'src/cart.ts', rule: 'no-secrets', message: 'm', indirectFix: false },
      ],
    )[0];
    expect(proofFailures(proof)).toEqual([
      'src/cart.ts holds 3 open violation(s): no-console, no-secrets',
    ]);
  });

  it('reports nothing for a member that did not fail', () => {
    expect(proofFailures(proveMember(0, 'k', true, [written]))).toEqual([]);
    expect(proofFailures(proveMember(0, 'k', false, []))).toEqual([]);
  });
});
