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
  parentDir,
  proveMember,
  proveTarget,
  unprovedMembers,
  type TargetProof,
} from '../../src/domain/targetProof.js';

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
