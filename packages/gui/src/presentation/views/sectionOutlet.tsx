/**
 * Section Outlet
 *
 * @fileoverview The one place the active rail subsystem becomes a view. Keeping
 * the mapping here means a new subsystem is a case and a component, and no other
 * file learns what sections exist.
 *
 * @module @paw/gui/presentation/views/sectionOutlet
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useSection } from '../../application/hooks/useConsole.js';
import { OverviewView } from './overviewView.js';
import { PendingView } from './pendingView.js';
import { RolesView } from './rolesView.js';
import { SwarmView } from './swarm/swarmView.js';
import { ViolationsView } from './violationsView.js';

/**
 * Titles for the subsystems no daemon report backs yet.
 */
const PENDING: Record<'gates' | 'keys' | 'logs', string> = {
  gates: 'Gates',
  keys: 'Keys',
  logs: 'Logs',
};

/**
 * The view for the active subsystem.
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
    default:
      return <PendingView title={PENDING[section]} />;
  }
}
