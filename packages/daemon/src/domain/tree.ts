/**
 * PAW Daemon File Tree
 *
 * @fileoverview Turns a flat directory listing into the {@link TreeNode} tree the
 * file selector browses, and narrows that tree to a subtree. Pure over its
 * input, so every rule the operator sees — what is hidden, what sorts first,
 * what a missing path means — is a unit test; the `readdir` walk that produces
 * the listing lives in `nodeRuntime`. Narrowing works on the already-built tree
 * rather than on a path, which is what keeps `/api/tree?root=…` structurally
 * unable to serve anything the daemon did not already decide to list.
 *
 * @module @paw/daemon/tree
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { TreeNode } from '@paw/core';

/**
 * One entry of a directory listing, relative to the served root.
 *
 * @interface FileEntry
 * @property {string} path - The entry's path relative to the root.
 * @property {boolean} isFile - Whether the entry is a file.
 */
export interface FileEntry {
  readonly path: string;
  readonly isFile: boolean;
}

/**
 * The directories a repository browser never wants to walk into: build output,
 * dependencies, and version-control internals.
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
 * A mutable node used while the tree is being assembled.
 *
 * @interface MutableNode
 * @property {string} name - The entry's own name.
 * @property {string} path - The entry's path.
 * @property {boolean} isFile - Whether it is a file.
 * @property {MutableNode[]} children - Child entries.
 */
interface MutableNode {
  name: string;
  path: string;
  isFile: boolean;
  children: MutableNode[];
}

/**
 * Normalise a listing path to the tree's own form: forward slashes, no leading
 * `./`, no trailing slash. Fails loud on an empty path — a listing that names
 * nothing is a defect in whatever produced it.
 *
 * @param {string} path - The raw path.
 * @returns {string} The normalised path.
 */
function normalise(path: string): string {
  const clean = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (clean.length === 0) {
    throw new Error('PAW tree: a listing entry has an empty path');
  }
  return clean;
}

/**
 * Whether any segment of a path is an ignored directory.
 *
 * @param {string} path - The normalised path.
 * @param {readonly string[]} ignore - The directory names to hide.
 * @returns {boolean} True when the entry should not be listed.
 */
function isHidden(path: string, ignore: readonly string[]): boolean {
  return path.split('/').some((segment) => ignore.includes(segment));
}

/**
 * Order siblings: directories first, then files, each alphabetically.
 *
 * @param {MutableNode} a - The left sibling.
 * @param {MutableNode} b - The right sibling.
 * @returns {number} The comparison result.
 */
function bySort(a: MutableNode, b: MutableNode): number {
  if (a.isFile !== b.isFile) {
    return a.isFile ? 1 : -1;
  }
  return a.name.localeCompare(b.name);
}

/**
 * Freeze the assembled tree into the served contract, sorting as it goes.
 *
 * @param {MutableNode[]} nodes - The assembled siblings.
 * @returns {TreeNode[]} The sorted, immutable nodes.
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
 * Build the file tree from a flat listing. Directories no entry named are
 * inferred from the paths of the files inside them, so a walk may list only
 * files and still produce a browsable tree.
 *
 * @param {readonly FileEntry[]} entries - The listing, relative to the root.
 * @param {readonly string[]} [ignore] - Directory names to hide.
 * @returns {TreeNode[]} The tree's roots.
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
 * The children of the node at `path`, or null when the tree has no such node. A
 * file answers with its own (empty) children rather than with null: it exists,
 * it simply contains nothing.
 *
 * @param {readonly TreeNode[]} nodes - The tree to search.
 * @param {string} path - The path to narrow to.
 * @returns {readonly TreeNode[] | null} The children, or null when absent.
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
