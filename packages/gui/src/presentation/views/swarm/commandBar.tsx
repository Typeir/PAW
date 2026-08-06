/**
 * Command Bar
 *
 * @fileoverview The foot of the Plan tab: the keybinding hint for member
 * scrubbing, and the two run controls that a daemon with a control API would
 * drive. They are disabled and say why, because a button that looks live and
 * does nothing teaches an operator to distrust the whole surface.
 *
 * @module @paw/gui/presentation/views/swarm/commandBar
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useConsoleData } from '../../../application/hooks/useConsole.js';
import { Button } from '../../atoms/button.js';
import { Tooltip } from '../../atoms/tooltip.js';
import { NEEDS_DAEMON } from './doctorBar.js';

/**
 * The Plan tab's command bar.
 *
 * @returns {JSX.Element} The bar.
 */
export function CommandBar() {
  const { run } = useConsoleData();
  return (
    <footer className='cmdbar'>
      <span style={{ color: 'var(--accent)' }}>plan</span>
      <span>
        scrub member <kbd>←</kbd> <kbd>→</kbd>
      </span>
      <Tooltip content={NEEDS_DAEMON} className='push'>
        <Button disabled>Pause herd</Button>
      </Tooltip>
      <Tooltip content={NEEDS_DAEMON}>
        <Button primary disabled>
          Capture · {run.confirmed}
        </Button>
      </Tooltip>
    </footer>
  );
}
