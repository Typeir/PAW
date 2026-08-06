/**
 * PAW Console Context Selection
 *
 * @fileoverview The rules of "which files ride along with every brief". A
 * selection is a set of repository paths, kept sorted so the console, the flag
 * it prints, and any two operators looking at the same screen agree on order.
 * Toggling is all-or-nothing over whatever was handed in, which is what lets one
 * checkbox act on a file and the next act on a folder's entire subtree: the
 * caller collects the paths, this decides what the click means. Pure — the tree
 * these paths come from is fetched elsewhere.
 *
 * @module @paw/gui/domain/context
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { TreeNode } from '@paw/core';

/**
 * Every file path at or beneath a node — a folder's whole subtree, or the file
 * itself. Directories are not selectable in their own right: a plan attaches
 * file contents, and a directory has none.
 *
 * @param {TreeNode} node - The node to collect from.
 * @returns {string[]} The file paths beneath it, in tree order.
 */
export function filesUnder(node: TreeNode): string[] {
  if (node.isFile) {
    return [node.path];
  }
  return node.children.flatMap(filesUnder);
}

/**
 * How much of a set of paths a selection already holds.
 *
 * @param {readonly string[]} selection - The current selection.
 * @param {readonly string[]} paths - The paths in question.
 * @returns {'none' | 'some' | 'all'} The coverage; an empty `paths` is `none`.
 */
export function coverage(
  selection: readonly string[],
  paths: readonly string[],
): 'none' | 'some' | 'all' {
  if (paths.length === 0) {
    return 'none';
  }
  const held = new Set(selection);
  const hits = paths.filter((path) => held.has(path)).length;
  if (hits === 0) {
    return 'none';
  }
  return hits === paths.length ? 'all' : 'some';
}

/**
 * Toggle a group of paths: drop them all when every one is already selected,
 * otherwise add the ones that are missing. Half-selected folders therefore fill
 * in rather than empty out, which is what an operator means by clicking a folder
 * they can see is partly chosen.
 *
 * @param {readonly string[]} selection - The current selection.
 * @param {readonly string[]} paths - The paths the click covers.
 * @returns {string[]} The next selection, sorted.
 */
export function toggleContext(
  selection: readonly string[],
  paths: readonly string[],
): string[] {
  if (paths.length === 0) {
    return [...selection];
  }
  const next = new Set(selection);
  if (coverage(selection, paths) === 'all') {
    for (const path of paths) {
      next.delete(path);
    }
  } else {
    for (const path of paths) {
      next.add(path);
    }
  }
  return [...next].sort((a, b) => a.localeCompare(b));
}

/**
 * The CLI argument that reproduces a selection — the bridge between picking
 * files in the console and running the plan with them, until a control API can
 * carry the selection itself. Empty when nothing is selected.
 *
 * @param {readonly string[]} selection - The selected paths.
 * @returns {string} The `--context` argument, or an empty string.
 */
export function contextArgument(selection: readonly string[]): string {
  return selection.length === 0 ? '' : `--context ${selection.join(',')}`;
}
