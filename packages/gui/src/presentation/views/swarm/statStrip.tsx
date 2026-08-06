/**
 * Swarm Stat Strip
 *
 * @fileoverview The four figures that summarise a run: how many members the plan
 * has, how many were dispatched against how many the plan's own `skip` filter
 * spared, how many came back confirmed, and what it cost. Before a run these
 * read zero, which is the truth about a plan that has not been released.
 *
 * @module @paw/gui/presentation/views/swarm/statStrip
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useConsoleData } from '../../../application/hooks/useConsole.js';
import { dispatchedCount } from '../../../domain/consoleState.js';
import { Stat } from '../../atoms/stat.js';

/**
 * The Swarm view's stat strip.
 *
 * @returns {JSX.Element} The strip.
 */
export function StatStrip() {
  const { plan, run, budget } = useConsoleData();
  return (
    <dl>
      <Stat label='Members' value={String(plan.total)} />
      <Stat
        label='Dispatched'
        value={
          <>
            {dispatchedCount(run)} <small>/ {run.skipped} skipped</small>
          </>
        }
      />
      <Stat label='Confirmed' value={String(run.confirmed)} tone='ok' />
      <Stat label='Spend' value={`$${budget.spendUsd.toFixed(2)}`} tone='ok' />
    </dl>
  );
}
