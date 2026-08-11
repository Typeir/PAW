/**
 * PAW Daemon file tree.
 *
 * @fileoverview Build {@link TreeNode} tree file selector browse from flat
 * directory listing. Narrow that tree to subtree. Pure over input; `readdir`
 * walk that make listing live in `nodeRuntime`. Narrowing work on built tree.
 *
 * @module @paw/daemon/tree
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { TreeNode } from '@paw/core';

/**
 * One entry of directory listing, relative to served root.
 *
 * @interface FileEntry
 * @property {string} path - Entry path relative to root.
 * @property {boolean} isFile - True when entry be file.
 */
export interface FileEntry {
  readonly path: string;
  readonly isFile: boolean;
}

/**
 * Directories tree omit: build output, dependencies, version-control
 * internals.
 */
export const IGNORED_DIRS: readonly string[] = [
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.next',
  '.turbo',
];

/**
 * Mutable node, use while assemble tree.
 *
 * @interface MutableNode
 * @property {string} name - Entry own name.
 * @property {string} path - Entry path.
 * @property {boolean} isFile - True when file.
 * @property {MutableNode[]} children - Child entries.
 */
interface MutableNode {
  name: string;
  path: string;
  isFile: boolean;
  children: MutableNode[];
}

/**
 * Normalise listing path to tree form: forward slashes, no leading `./`, no
 * trailing slash. Throw on empty path.
 *
 * @param {string} path - Raw path.
 * @returns {string} Normalised path.
 */
function normalise(path: string): string {
  const clean = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (clean.length === 0) {
    throw new Error('PAW tree: a listing entry has an empty path');
  }
  return clean;
}

/**
 * Check whether any segment of path be ignored directory.
 *
 * @param {string} path - Normalised path.
 * @param {readonly string[]} ignore - Directory names to hide.
 * @returns {boolean} True when entry should not list.
 */
function isHidden(path: string, ignore: readonly string[]): boolean {
  return path.split('/').some((segment) => ignore.includes(segment));
}

/**
 * Order siblings: directories first, then files, each alphabetically.
 *
 * @param {MutableNode} a - Left sibling.
 * @param {MutableNode} b - Right sibling.
 * @returns {number} Comparison result.
 */
function bySort(a: MutableNode, b: MutableNode): number {
  if (a.isFile !== b.isFile) {
    return a.isFile ? 1 : -1;
  }
  return a.name.localeCompare(b.name);
}

/**
 * Freeze assembled tree into served contract, sort on the way.
 *
 * @param {MutableNode[]} nodes - Assembled siblings.
 * @returns {TreeNode[]} Sorted, immutable nodes.
 */
function seal(nodes: MutableNode[]): TreeNode[] {
  return [...nodes].sort(bySort).map((node) => ({
    name: node.name,
    path: node.path,
    isFile: node.isFile,
    children: seal(node.children),
  }));
}

/**
 * Build file tree from flat listing. Directories with no entry name get
 * inferred from paths of files inside them.
 *
 * @param {readonly FileEntry[]} entries - Listing, relative to root.
 * @param {readonly string[]} [ignore] - Directory names to hide.
 * @returns {TreeNode[]} Tree roots.
 */
export function buildFileTree(
  entries: readonly FileEntry[],
  ignore: readonly string[] = IGNORED_DIRS,
): TreeNode[] {
  const roots: MutableNode[] = [];
  const byPath = new Map<string, MutableNode>();

  for (const entry of entries) {
    const path = normalise(entry.path);
    if (isHidden(path, ignore)) {
      continue;
    }
    const segments = path.split('/');
    let siblings = roots;
    let walked = '';
    segments.forEach((name, index) => {
      walked = walked === '' ? name : `${walked}/${name}`;
      const leaf = index === segments.length - 1;
      const existing = byPath.get(walked);
      if (existing) {
        existing.isFile = leaf ? entry.isFile : false;
        siblings = existing.children;
        return;
      }
      const node: MutableNode = {
        name,
        path: walked,
        isFile: leaf ? entry.isFile : false,
        children: [],
      };
      byPath.set(walked, node);
      siblings.push(node);
      siblings = node.children;
    });
  }

  return seal(roots);
}

/**
 * Children of node at `path`, or null when tree have no such node. File return
 * its own empty children array.
 *
 * @param {readonly TreeNode[]} nodes - Tree to search.
 * @param {string} path - Path to narrow to.
 * @returns {readonly TreeNode[] | null} Children, or null when absent.
 */
export function findSubtree(
  nodes: readonly TreeNode[],
  path: string,
): readonly TreeNode[] | null {
  let siblings: readonly TreeNode[] = nodes;
  for (const segment of normalise(path).split('/')) {
    const found = siblings.find((node) => node.name === segment);
    if (!found) {
      return null;
    }
    siblings = found.children;
  }
  return siblings;
}
