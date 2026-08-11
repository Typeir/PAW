/**
 * PAW Console Live Refresh
 *
 * @fileoverview Poll snapshot source, hand each result to console.
 * Daemon re-reads current state on every request: uptime rises, resident
 * memory changes, owned-process table changes as workers start and stop.
 * Source `null` be static artifact, poll nothing. Failed poll caught, returned
 * as message shell renders: console shows the error, so a failed snapshot is
 * never displayed as live.
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
 * Source of snapshots — `pawd`'s `/api/state` in live shell. Plan selects
 * which of the daemon's repository of plans to view; each request passes the
 * selected plan.
 */
export type SnapshotSource = (plan: string | null) => Promise<PawSnapshot>;

/**
 * Poll source, hand each snapshot to console. Changing the selected plan
 * triggers an immediate re-read in the same tick, so the new plan is reflected
 * before the next poll period.
 *
 * @param {SnapshotSource | null} source - Source to poll, or null for static page.
 * @param {number} intervalMs - Poll period in milliseconds.
 * @param {string | null} plan - Plan console look at.
 * @param {(data: ConsoleData) => void} onSnapshot - Sink for each hydrated snapshot.
 * @returns {string | null} Last failure message, or null while healthy.
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
