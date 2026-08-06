/**
 * PAW Console Tree Loading
 *
 * @fileoverview Loads the repository tree the file selector browses. Unlike the
 * snapshot, the tree is fetched once when the selector needs it rather than
 * polled — a file list that reshuffled under the operator's cursor mid-selection
 * would be hostile, and the daemon rebuilds its own copy on its own schedule for
 * the next open. A source of `null` is the static artifact: there is no
 * repository behind that page, and the hook says so instead of showing an empty
 * tree that would read as an empty repository.
 *
 * @module @paw/gui/application/hooks/useTree
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { TreeNode } from '@paw/core';
import { useEffect, useState } from 'react';
import type { TreeSource } from '../../infrastructure/snapshotSource.js';

/**
 * The tree as a panel sees it.
 *
 * @interface TreeState
 * @property {TreeNode[]} tree - The nodes loaded so far; empty until they arrive.
 * @property {boolean} loading - Whether a load is in flight.
 * @property {string | null} error - Why the load failed, or null.
 * @property {boolean} available - Whether there is a daemon to ask at all.
 */
export interface TreeState {
  readonly tree: readonly TreeNode[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly available: boolean;
}

/**
 * Load a repository tree from a source.
 *
 * @param {TreeSource | null} source - The source, or null when the page is static.
 * @returns {TreeState} The tree and its health.
 */
export function useTree(source: TreeSource | null): TreeState {
  const [tree, setTree] = useState<readonly TreeNode[]>([]);
  const [loading, setLoading] = useState(source !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (source === null) {
      return undefined;
    }
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const nodes = await source();
        if (live) {
          setTree(nodes);
          setError(null);
        }
      } catch (err: unknown) {
        if (live) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (live) {
          setLoading(false);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [source]);

  return { tree, loading, error, available: source !== null };
}
