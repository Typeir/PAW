/**
 * Doctor Bar
 *
 * @fileoverview Pre-flight checks evaluated by `doctorPlan`. Each check resolves one question: member count non-zero? every member has a brief? two members claim the same file? plan role binds to a model that satisfies it? Findings computed directly from plan state. Bar green when plan is sound.
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
 * Run controls are disabled until a running pawd daemon is present.
 */
export const NEEDS_DAEMON = 'requires a running pawd daemon';

/**
 * Plan doctor bar.
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
