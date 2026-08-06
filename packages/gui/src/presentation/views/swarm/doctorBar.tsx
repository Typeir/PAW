/**
 * Doctor Bar
 *
 * @fileoverview The plan's pre-flight, as `doctorPlan` reported it: does the
 * member count resolve, does every member get a non-empty brief, do two members
 * claim the same file, and is the plan's role bound to a model that satisfies
 * it. These are real findings computed by core over the real plan — the bar goes
 * green because the plan is sound, not because the console decided to.
 *
 * @module @paw/gui/presentation/views/swarm/doctorBar
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { Minus, Play } from 'lucide-react';
import { useConsoleData } from '../../../application/hooks/useConsole.js';
import { checkOk, planRoleOk } from '../../../domain/consoleState.js';
import { Button } from '../../atoms/button.js';
import { Check } from '../../atoms/check.js';
import { Tooltip } from '../../atoms/tooltip.js';

/**
 * The reason the run controls are inert until a daemon can drive them.
 */
export const NEEDS_DAEMON = 'requires a running pawd daemon';

/**
 * The plan doctor bar.
 *
 * @returns {JSX.Element} The bar.
 */
export function DoctorBar() {
  const data = useConsoleData();
  const { plan, checks, run } = data;
  return (
    <section className='doctorbar' aria-label='swarm doctor'>
      <h2 className='lead'>doctor</h2>
      <ul>
        <Check label='count' ok={checkOk(checks, 'count')} value={String(plan.total)} />
        <Check label='total-brief' ok={checkOk(checks, 'total-brief')} />
        <Check label='file-conflict' ok={checkOk(checks, 'file-conflict')} />
        <Check label='role' ok={planRoleOk(data)} value={plan.role} />
        <li className='chk'>
          <span className='mut' aria-hidden='true'>
            <Minus size={13} strokeWidth={2.5} />
          </span>{' '}
          skip <b>{run.skipped}</b>
        </li>
      </ul>
      <p className='acts'>
        <Tooltip content={NEEDS_DAEMON}>
          <Button disabled>
            Dry-run <Play size={11} aria-hidden='true' />
          </Button>
        </Tooltip>
        <Tooltip content={NEEDS_DAEMON}>
          <Button primary disabled>
            Capture · {run.confirmed}
          </Button>
        </Tooltip>
      </p>
    </section>
  );
}
