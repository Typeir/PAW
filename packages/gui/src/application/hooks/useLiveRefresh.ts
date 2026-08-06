/**
 * PAW Console Live Refresh
 *
 * @fileoverview Polls a snapshot source and folds each result into the console.
 * The daemon re-reads the host on every request, so this is what makes the page
 * live: uptime climbs, resident memory moves, the owned-process table changes as
 * workers come and go. A source of `null` is the static artifact, which polls
 * nothing. A failed poll is caught and returned as a message the shell renders —
 * the one degradation this hook is allowed, and it is loud: the console says the
 * wire is down instead of showing a frozen snapshot that still looks live.
 *
 * @module @paw/gui/application/hooks/useLiveRefresh
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { PawSnapshot } from '@paw/core';
import { useEffect, useState } from 'react';
import type { ConsoleData } from '../../domain/console.types.js';
import { hydrate } from '../hydrateSnapshot.js';

/**
 * A source of snapshots — `pawd`'s `/api/state` in the live shell. The plan is
 * the console's selection: one daemon serves a repository of plans, and every
 * request says which one it is looking at.
 */
export type SnapshotSource = (plan: string | null) => Promise<PawSnapshot>;

/**
 * Poll a source and hand each snapshot to the console. Changing the selected
 * plan re-reads at once rather than at the next tick, so picking a plan is
 * immediate instead of taking up to a poll period.
 *
 * @param {SnapshotSource | null} source - The source to poll, or null for a static page.
 * @param {number} intervalMs - The poll period in milliseconds.
 * @param {string | null} plan - The plan the console is looking at.
 * @param {(data: ConsoleData) => void} onSnapshot - Sink for each hydrated snapshot.
 * @returns {string | null} The last failure message, or null while healthy.
 */
export function useLiveRefresh(
  source: SnapshotSource | null,
  intervalMs: number,
  plan: string | null,
  onSnapshot: (data: ConsoleData) => void,
): string | null {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (source === null) {
      return undefined;
    }
    let live = true;
    const tick = async (): Promise<void> => {
      try {
        const snapshot = await source(plan);
        if (live) {
          onSnapshot(hydrate(snapshot));
          setError(null);
        }
      } catch (err: unknown) {
        if (live) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [source, intervalMs, plan, onSnapshot]);

  return error;
}
