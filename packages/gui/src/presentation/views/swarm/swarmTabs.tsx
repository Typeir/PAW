/**
 * Swarm Tabs
 *
 * @fileoverview The Plan / Herd / Logs tab bar, wired as a real ARIA tablist so
 * the panel below is announced as the tab's content. The Herd tab carries the
 * confirmed-over-dispatched badge, which is the one number an operator watching
 * a run keeps an eye on.
 *
 * @module @paw/gui/presentation/views/swarm/swarmTabs
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { FileCode2 } from 'lucide-react';
import { useConsoleActions } from '../../../application/hooks/useConsoleActions.js';
import { useConsoleData, useTab } from '../../../application/hooks/useConsole.js';
import { dispatchedCount } from '../../../domain/consoleState.js';
import type { Tab } from '../../../domain/console.types.js';

/**
 * Props for {@link TabButton}.
 *
 * @interface TabButtonProps
 * @property {Tab} id - The tab this button selects.
 * @property {React.ReactNode} children - The tab label.
 */
interface TabButtonProps {
  readonly id: Tab;
  readonly children: React.ReactNode;
}

/**
 * One tab button.
 *
 * @param {TabButtonProps} props - The button props.
 * @returns {JSX.Element} The tab.
 */
function TabButton({ id, children }: TabButtonProps) {
  const tab = useTab();
  const { showTab } = useConsoleActions();
  const on = tab === id;
  return (
    <button
      type='button'
      className={on ? 'tab on' : 'tab'}
      role='tab'
      id={`tab-${id}`}
      aria-controls='swarm-panel'
      aria-selected={on}
      onClick={() => showTab(id)}>
      {children}
    </button>
  );
}

/**
 * The Swarm view's tab bar.
 *
 * @returns {JSX.Element} The tabs.
 */
export function SwarmTabs() {
  const { run } = useConsoleData();
  return (
    <div className='tabs' role='tablist' aria-label='Swarm views'>
      <TabButton id='plan'>
        <FileCode2 size={13} aria-hidden='true' /> Plan
      </TabButton>
      <TabButton id='herd'>
        Herd
        <span className='live' aria-hidden='true' />
        <span className='badge'>
          {run.confirmed}/{dispatchedCount(run)}
        </span>
      </TabButton>
      <TabButton id='logs'>Logs</TabButton>
    </div>
  );
}
