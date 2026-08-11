/**
 * Command Bar
 *
 * @fileoverview Foot of Plan tab. Shows member-scrub keybinding hint and the
 * release control: select fake or live model, then send a release frame carrying
 * the selected context items. The daemon releases only after the operator
 * confirms at the terminal running pawd. The button is disabled until the
 * console is live and a plan is selected; the tooltip states the reason.
 *
 * @module @paw/gui/presentation/views/swarm/commandBar
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useState } from 'react';
import { useLiveStatus, useScope } from '../../../application/context/consoleContext.js';
import { useConsoleData, useContextSelection } from '../../../application/hooks/useConsole.js';
import { Button } from '../../atoms/button.js';
import { Tooltip } from '../../atoms/tooltip.js';

/**
 * Why the release button be disabled, or null when it may fire.
 *
 * @param {boolean} live - Console socket live?
 * @param {string | null} plan - Selected plan, if any.
 * @returns {string | null} Reason, or null when releasable.
 */
export function releaseBlocker(live: boolean, plan: string | null): string | null {
  if (!live) {
    return 'release needs a live connection';
  }
  if (plan === null) {
    return 'pick a plan to release';
  }
  return null;
}

/**
 * Plan tab command bar.
 *
 * @returns {JSX.Element} The bar.
 */
export function CommandBar() {
  const { selectedPlan } = useConsoleData();
  const { mode } = useLiveStatus();
  const { release } = useScope();
  const selection = useContextSelection();
  const [liveModel, setLiveModel] = useState(false);
  const [asked, setAsked] = useState(false);

  const blocker = releaseBlocker(mode === 'live', selectedPlan);
  const releasable = blocker === null && selectedPlan !== null ? selectedPlan : null;

  return (
    <footer className='cmdbar'>
      <span style={{ color: 'var(--accent)' }}>plan</span>
      <span>
        scrub member <kbd>←</kbd> <kbd>→</kbd>
      </span>
      {asked && <span role='status'>release asked · approve it in the pawd terminal</span>}
      <label className='push cmdbar-live'>
        <input
          type='checkbox'
          checked={liveModel}
          onChange={(event) => setLiveModel(event.target.checked)}
        />
        live model
      </label>
      {releasable !== null ? (
        <Button
          primary
          onClick={() => {
            release({
              plan: releasable,
              live: liveModel,
              ...(selection.length > 0 ? { context: selection } : {}),
            });
            setAsked(true);
          }}>
          Release herd{selection.length > 0 ? ` · ${selection.length} ctx` : ''}
        </Button>
      ) : (
        <Tooltip content={blocker as string}>
          <Button primary disabled>
            Release herd
          </Button>
        </Tooltip>
      )}
    </footer>
  );
}
