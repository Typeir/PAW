/**
 * Swarm Tabs
 *
 * @fileoverview Plan / Herd / Logs tab bar. ARIA tablist. Panel below
 * announce as tab content. Herd tab carry confirmed-over-dispatched badge.
 * Operator watching run reads that number.
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
 * @property {Tab} id - Tab button select.
 * @property {React.ReactNode} children - Tab label.
 */
interface TabButtonProps {
  readonly id: Tab;
  readonly children: React.ReactNode;
}

/**
 * One tab button.
 *
 * @param {TabButtonProps} props - Button props.
 * @returns {JSX.Element} Tab.
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
 * Swarm view tab bar.
 *
 * @returns {JSX.Element} Tabs.
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
