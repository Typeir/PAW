/**
 * Preview Card
 *
 * @fileoverview Render brief for scrubbed member — the `--show` dry-run, in
 * window. Text be daemon's own `renderBrief` output, so what author read here
 * be byte-for-byte what model get sent. Editing hold local draft, offer reset;
 * scrub to another member drop that draft, no carry one member's edit onto next.
 *
 * @module @paw/gui/presentation/views/swarm/previewCard
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useBrief,
  useHasDraft,
  useMember,
  useMemberView,
  usePlan,
} from '../../../application/hooks/useConsole.js';
import { useConsoleActions } from '../../../application/hooks/useConsoleActions.js';
import { slugOf } from '../../../domain/plan.js';
import { Button } from '../../atoms/button.js';
import { Card } from '../../atoms/card.js';

/**
 * Brief preview and member scrubber.
 *
 * @returns {JSX.Element} Card.
 */
export function PreviewCard() {
  const plan = usePlan();
  const member = useMember();
  const brief = useBrief();
  const hasDraft = useHasDraft();
  const view = useMemberView();
  const { step, edit, reset } = useConsoleActions();
  const level = view !== undefined && view.level !== null ? ` · lvl ${view.level}` : '';

  return (
    <Card title='Rendered brief' meta='the --show dry-run' variant='preview'>
      <nav className='scrub' aria-label='Member scrubber'>
        <button
          type='button'
          className='arw'
          aria-label='Previous member'
          onClick={() => step(-1)}>
          <ChevronLeft size={15} aria-hidden='true' />
        </button>
        <span className='mno'>
          member {member + 1} / {plan.total}
        </span>
        <button type='button' className='arw' aria-label='Next member' onClick={() => step(1)}>
          <ChevronRight size={15} aria-hidden='true' />
        </button>
        <span className='slug'>{`${slugOf(plan, member)}${level}`}</span>
        {hasDraft && (
          <Button align='gap' onClick={reset}>
            reset
          </Button>
        )}
      </nav>
      <textarea
        className='brieftext'
        aria-label='Member brief'
        value={brief}
        onChange={(event) => edit(event.target.value)}
      />
    </Card>
  );
}
