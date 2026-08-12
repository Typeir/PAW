/**
 * Section Outlet
 *
 * @fileoverview Maps active section to its view. Adding a subsystem requires
 * one switch case and one component. No other file knows what sections exist.
 *
 * @module @paw/gui/presentation/views/sectionOutlet
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useSection } from '../../application/hooks/useConsole.js';
import { LogsView } from './logsView.js';
import { OverviewView } from './overviewView.js';
import { PendingView } from './pendingView.js';
import { RolesView } from './rolesView.js';
import { SwarmView } from './swarm/swarmView.js';
import { ViolationsView } from './violationsView.js';

/**
 * Titles for subsystem no daemon report back yet.
 */
const PENDING: Record<'gates' | 'keys', string> = {
  gates: 'Gates',
  keys: 'Keys',
};

/**
 * View for active subsystem.
 *
 * @returns {JSX.Element} The view.
 */
export function SectionOutlet() {
  const section = useSection();
  switch (section) {
    case 'swarm':
      return <SwarmView />;
    case 'overview':
      return <OverviewView />;
    case 'roles':
      return <RolesView />;
    case 'violations':
      return <ViolationsView />;
    case 'logs':
      return <LogsView />;
    default:
      return <PendingView title={PENDING[section]} />;
  }
}
