/**
 * Context Selection Tests
 *
 * @fileoverview What a checkbox means: collecting the files under a node,
 * reading how much of a group is already attached, and toggling a group as a
 * whole — including the half-selected folder that fills in rather than empties.
 *
 * @module @paw/gui/test/unit/domain/context
 */

import type { TreeNode } from '@paw/core';
import { describe, expect, it } from 'vitest';
import {
  contextArgument,
  coverage,
  filesUnder,
  toggleContext,
} from '../../../src/domain/context.js';

const file = (path: string): TreeNode => ({
  name: path.split('/').pop() ?? path,
  path,
  isFile: true,
  children: [],
});

const tree: TreeNode = {
  name: 'src',
  path: 'src',
  isFile: false,
  children: [
    file('src/a.ts'),
    {
      name: 'domain',
      path: 'src/domain',
      isFile: false,
      children: [file('src/domain/b.ts'), file('src/domain/c.ts')],
    },
  ],
};

describe('filesUnder', () => {
  it('collects a file as itself', () => {
    expect(filesUnder(file('a.md'))).toEqual(['a.md']);
  });

  it('collects every file beneath a folder, at any depth', () => {
    expect(filesUnder(tree)).toEqual(['src/a.ts', 'src/domain/b.ts', 'src/domain/c.ts']);
  });

  it('collects nothing from an empty folder', () => {
    expect(filesUnder({ name: 'empty', path: 'empty', isFile: false, children: [] })).toEqual([]);
  });
});

describe('coverage', () => {
  it('reports none, some, and all', () => {
    const paths = ['a', 'b'];
    expect(coverage([], paths)).toBe('none');
    expect(coverage(['a'], paths)).toBe('some');
    expect(coverage(['a', 'b'], paths)).toBe('all');
  });

  it('reports an empty group as none rather than as fully covered', () => {
    expect(coverage(['a'], [])).toBe('none');
  });
});

describe('toggleContext', () => {
  it('attaches what is missing and keeps the selection sorted', () => {
    expect(toggleContext(['z.md'], ['a.md'])).toEqual(['a.md', 'z.md']);
  });

  it('fills in a partly attached group instead of emptying it', () => {
    expect(toggleContext(['a'], ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('detaches a group that was fully attached', () => {
    expect(toggleContext(['a', 'b', 'c'], ['a', 'b'])).toEqual(['c']);
  });

  it('changes nothing for an empty group', () => {
    expect(toggleContext(['a'], [])).toEqual(['a']);
  });
});

describe('contextArgument', () => {
  it('prints the flag that reproduces a selection', () => {
    expect(contextArgument(['a.ts', 'src/b.ts'])).toBe('--context a.ts,src/b.ts');
  });

  it('prints nothing when nothing is attached', () => {
    expect(contextArgument([])).toBe('');
  });
});
