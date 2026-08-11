/**
 * PAW Console Tree Loading
 *
 * @fileoverview Load repository tree file selector browse. Unlike snapshot,
 * fetch the tree once when the selector needs it instead of polling. Fetching
 * once keeps the list stable while the operator selects; a refetch could
 * reorder items under the cursor. The daemon rebuilds its copy on its own
 * schedule for the next open. A `null` source marks a static page with no
 * repository behind it; the hook reports that as unavailable instead of
 * returning an empty tree that would be mistaken for an empty repository.
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
 * The tree state the panel consumes.
 *
 * @interface TreeState
 * @property {TreeNode[]} tree - Nodes loaded so far; empty until they arrive.
 * @property {boolean} loading - Whether a load in flight.
 * @property {string | null} error - Why load fail, or null.
 * @property {boolean} available - Whether a source is present at all (source !== null).
 */
export interface TreeState {
  readonly tree: readonly TreeNode[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly available: boolean;
}

/**
 * Load repository tree from source.
 *
 * @param {TreeSource | null} source - The source, or null when page static.
 * @returns {TreeState} The tree state: nodes, loading, error, availability.
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
