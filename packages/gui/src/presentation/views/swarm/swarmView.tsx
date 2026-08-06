/**
 * Swarm View
 *
 * @fileoverview The Work subsystem and the console's reason to exist: a plan,
 * the briefs it renders, the herd it dispatched, and the doctor's verdict on all
 * of it. The tab body is a real ARIA tab panel labelled by the active tab, so
 * the three views read as one instrument rather than three pages.
 *
 * @module @paw/gui/presentation/views/swarm/swarmView
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useConsoleData, useTab } from '../../../application/hooks/useConsole.js';
import { Card } from '../../atoms/card.js';
import { Crumb } from '../../atoms/crumb.js';
import { Placeholder } from '../../atoms/placeholder.js';
import { PlanPicker } from '../../atoms/planPicker.js';
import { CodeCard } from './codeCard.js';
import { CommandBar } from './commandBar.js';
import { ContextCard } from './contextCard.js';
import { DoctorBar } from './doctorBar.js';
import { HerdTab } from './herdTab.js';
import { PreviewCard } from './previewCard.js';
import { RunBar } from './runBar.js';
import { StatStrip } from './statStrip.js';
import { SwarmTabs } from './swarmTabs.js';

/**
 * The Plan tab: the author grid over the doctor and command bars.
 *
 * @returns {JSX.Element} The tab body.
 */
function PlanTab() {
  return (
    <>
      <div className='authorgrid'>
        <CodeCard />
        <div className='authorside'>
          <PreviewCard />
          <ContextCard />
        </div>
      </div>
      <DoctorBar />
      <CommandBar />
    </>
  );
}

/**
 * The Logs tab.
 *
 * @returns {JSX.Element} The tab body.
 */
function LogsTab() {
  return (
    <Card title='Logs'>
      <Placeholder>— live log stream — a pawd control API will back this —</Placeholder>
    </Card>
  );
}

/**
 * The active tab's body.
 *
 * @returns {JSX.Element} The tab body.
 */
function TabBody() {
  const tab = useTab();
  if (tab === 'plan') {
    return <PlanTab />;
  }
  if (tab === 'herd') {
    return <HerdTab />;
  }
  return <LogsTab />;
}

/**
 * The Swarm subsystem.
 *
 * @returns {JSX.Element} The view.
 */
export function SwarmView() {
  const { run, selectedPlan, plans } = useConsoleData();
  const tab = useTab();

  if (selectedPlan === null) {
    return (
      <>
        <Crumb title='Swarm'>
          <PlanPicker />
        </Crumb>
        <Card title='No plan selected' meta={`${plans.length} in this repository`}>
          <Placeholder>
            {plans.length === 0
              ? '— this repository holds no *.swarm.mjs —'
              : '— pick a plan to read its briefs and release its herd —'}
          </Placeholder>
        </Card>
      </>
    );
  }

  return (
    <>
      <Crumb title='Swarm' sub={`run ${run.startedAt}`}>
        <PlanPicker />
      </Crumb>
      <StatStrip />
      <SwarmTabs />
      <RunBar />
      <div role='tabpanel' id='swarm-panel' aria-labelledby={`tab-${tab}`} tabIndex={0}>
        <TabBody />
      </div>
    </>
  );
}
