/**
 * Run Bar
 *
 * @fileoverview The run's identity and its split across the plan's members, as a
 * segmented meter and the four counts behind it. Widths are shares of the whole
 * plan, so the slate band on the left is the work the plan's `skip` filter saved
 * — the cheapest tokens in the system, and worth seeing.
 *
 * @module @paw/gui/presentation/views/swarm/runBar
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useConsoleData } from '../../../application/hooks/useConsole.js';
import { Meter, type Segment } from '../../atoms/meter.js';

/**
 * The active run bar.
 *
 * @returns {JSX.Element} The bar.
 */
export function RunBar() {
  const { run, plan } = useConsoleData();
  const segments: readonly Segment[] = [
    { name: 'skipped', value: run.skipped, colorVar: '--idle' },
    { name: 'done', value: run.done, colorVar: '--good' },
    { name: 'running', value: run.running, colorVar: '--accent' },
    { name: 'failed', value: run.failed, colorVar: '--crit' },
  ];
  return (
    <section className='runbar' aria-label='Active run'>
      <span className='k'>run</span> <b>{run.id}</b>
      <Meter segments={segments} total={plan.total} />
      <span className='k'>skip</span> <b>{run.skipped}</b>
      <span className='k'>·</span>
      <span style={{ color: 'var(--good)' }}>
        done <b>{run.done}</b>
      </span>
      <span className='k'>·</span>
      <span style={{ color: 'var(--accent)' }}>
        run <b>{run.running}</b>
      </span>
      <span className='k'>·</span>
      <span style={{ color: 'var(--crit)' }}>
        fail <b>{run.failed}</b>
      </span>
    </section>
  );
}
