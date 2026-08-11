/**
 * Swarm Stat Strip
 *
 * @fileoverview Four figures describing a run: total members in the plan,
 * dispatched count against the plan's `skip` filter allowance, confirmed
 * returns, and spend. Before a run these read zero, indicating the plan
 * has not been released yet.
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
 * Swarm view stat strip.
 *
 * @returns {JSX.Element} The strip with four figures laid out.
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
