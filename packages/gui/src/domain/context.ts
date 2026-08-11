/**
 * PAW Console Context Selection
 *
 * @fileoverview Rules of which files ship with every brief. Selection be set of repo paths, kept sorted so console, printed flag, and two operators on same screen agree on order. Toggle all-or-nothing over what handed in. That let one checkbox act on a file, next on folder whole subtree: caller collect paths, this decide what click mean. No I/O — this module computes from caller-supplied tree paths.
 *
 * @module @paw/gui/domain/context
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { TreeNode } from '@paw/core';

/**
 * Every file path at or beneath a node — folder whole subtree, or file itself. Directory no select alone: plan attach file contents, directory got none.
 *
 * @param {TreeNode} node - Node to collect from.
 * @returns {string[]} File paths beneath it, in tree order.
 */
export function filesUnder(node: TreeNode): string[] {
  if (node.isFile) {
    return [node.path];
  }
  return node.children.flatMap(filesUnder);
}

/**
 * How much of a set of paths a selection already hold.
 *
 * @param {readonly string[]} selection - Current selection.
 * @param {readonly string[]} paths - Paths in question.
 * @returns {'none' | 'some' | 'all'} Coverage; empty `paths` be `none`.
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
 * Toggle a group of paths: drop all when every one already selected, add missing ones. Half-selected folders fill in with the missing paths.
 *
 * @param {readonly string[]} selection - Current selection.
 * @param {readonly string[]} paths - Paths the click cover.
 * @returns {string[]} Next selection, sorted.
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
 * Reproduce a selection as a CLI argument: pick files in console, pass them to plan run, until control API carry the selection itself. Empty when nothing selected.
 *
 * @param {readonly string[]} selection - Selected paths.
 * @returns {string} The `--context` argument, or empty string.
 */
export function contextArgument(selection: readonly string[]): string {
  return selection.length === 0 ? '' : `--context ${selection.join(',')}`;
}
