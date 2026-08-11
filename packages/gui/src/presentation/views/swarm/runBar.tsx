/**
 * Run Bar
 *
 * @fileoverview Show run identity and split across plan members. Segmented
 * meter and four counts behind it. Widths equal shares of whole plan. Skip
 * count reads run.skipped.
 *
 * @module @paw/gui/presentation/views/swarm/runBar
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useConsoleData } from '../../../application/hooks/useConsole.js';
import { Meter, type Segment } from '../../atoms/meter.js';

/**
 * Active run bar.
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
