/**
 * File Tree Tests
 *
 * @fileoverview The pure half of `/api/tree`: nesting a flat directory listing,
 * dropping the paths nobody wants to browse, ordering folders before files, and
 * narrowing to a subtree. Also the loud refusals — a listing entry with no path
 * is a producer defect, not something to quietly drop.
 *
 * @module @paw/daemon/test/tree
 */

import { describe, expect, it } from 'vitest';
import { IGNORED_DIRS, buildFileTree, findSubtree, type FileEntry } from '../src/tree.js';

const entries: FileEntry[] = [
  { path: 'README.md', isFile: true },
  { path: 'src', isFile: false },
  { path: 'src/main.ts', isFile: true },
  { path: 'src/domain/plan.ts', isFile: true },
  { path: 'src/domain/swarm.ts', isFile: true },
  { path: 'package.json', isFile: true },
];

describe('buildFileTree', () => {
  it('nests a flat listing into a tree', () => {
    const tree = buildFileTree(entries);
    expect(tree.map((n) => n.path)).toEqual(['src', 'package.json', 'README.md']);
    const src = tree[0];
    expect(src.isFile).toBe(false);
    expect(src.children.map((n) => n.path)).toEqual([
      'src/domain',
      'src/main.ts',
    ]);
    expect(src.children[0].children.map((n) => n.name)).toEqual(['plan.ts', 'swarm.ts']);
  });

  it('infers a directory nobody listed from the files inside it', () => {
    const tree = buildFileTree([{ path: 'a/b/c.txt', isFile: true }]);
    expect(tree[0]).toMatchObject({ name: 'a', path: 'a', isFile: false });
    expect(tree[0].children[0]).toMatchObject({ name: 'b', path: 'a/b', isFile: false });
    expect(tree[0].children[0].children[0]).toMatchObject({
      name: 'c.txt',
      path: 'a/b/c.txt',
      isFile: true,
      children: [],
    });
  });

  it('orders directories before files, each alphabetically', () => {
    const tree = buildFileTree([
      { path: 'z.md', isFile: true },
      { path: 'a.md', isFile: true },
      { path: 'zeta/one.md', isFile: true },
      { path: 'alpha/two.md', isFile: true },
    ]);
    expect(tree.map((n) => n.name)).toEqual(['alpha', 'zeta', 'a.md', 'z.md']);
  });

  it('drops the directories nobody browses, at any depth', () => {
    const tree = buildFileTree([
      { path: 'node_modules/react/index.js', isFile: true },
      { path: '.git/HEAD', isFile: true },
      { path: 'packages/gui/dist/index.html', isFile: true },
      { path: 'packages/gui/src/main.tsx', isFile: true },
    ]);
    expect(tree.map((n) => n.name)).toEqual(['packages']);
    expect(tree[0].children[0].children.map((n) => n.name)).toEqual(['src']);
    expect(IGNORED_DIRS).toContain('node_modules');
  });

  it('honours a caller’s own ignore list', () => {
    const tree = buildFileTree([{ path: 'docs/a.md', isFile: true }], ['docs']);
    expect(tree).toEqual([]);
  });

  it('normalises Windows separators and a leading ./', () => {
    const tree = buildFileTree([{ path: '.\\src\\a.ts', isFile: true }]);
    expect(tree[0].path).toBe('src');
    expect(tree[0].children[0].path).toBe('src/a.ts');
  });

  it('keeps a directory a directory when the listing names it after its files', () => {
    const tree = buildFileTree([
      { path: 'src/a.ts', isFile: true },
      { path: 'src', isFile: false },
      { path: 'src/a.ts', isFile: true },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ name: 'src', isFile: false });
    expect(tree[0].children.map((n) => n.name)).toEqual(['a.ts']);
    expect(tree[0].children[0].isFile).toBe(true);
  });

  it('fails loud on a listing entry with no path', () => {
    expect(() => buildFileTree([{ path: '', isFile: true }])).toThrow('empty path');
  });
});

describe('findSubtree', () => {
  const tree = buildFileTree(entries);

  it('returns the children of the named directory', () => {
    expect(findSubtree(tree, 'src')?.map((n) => n.path)).toEqual(['src/domain', 'src/main.ts']);
    expect(findSubtree(tree, 'src/domain')?.map((n) => n.name)).toEqual(['plan.ts', 'swarm.ts']);
  });

  it('returns a file’s empty children rather than pretending it has some', () => {
    expect(findSubtree(tree, 'README.md')).toEqual([]);
  });

  it('returns null for a path the tree does not contain', () => {
    expect(findSubtree(tree, 'nope')).toBeNull();
    expect(findSubtree(tree, 'src/nope/deeper')).toBeNull();
  });
});
