/**
 * Rail
 *
 * @fileoverview Left rail. Groups subsystems Enforce, Models, Work above a
 * foot of daemon facts. `nav` contains lists under headings. Foot is a
 * description list; each line is a labelled value. Screen reader announces
 * each group heading before its buttons. Counts come from snapshot, open
 * violation visible from anywhere in console. Foot socket and resident
 * memory come from daemon report.
 *
 * @module @paw/gui/presentation/chrome/rail
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  Boxes,
  KeyRound,
  LayoutDashboard,
  Plug,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
  Workflow,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useConsoleData } from '../../application/hooks/useConsole.js';
import { NavItem } from '../atoms/navItem.js';

/**
 * Props for {@link Group}.
 *
 * @interface GroupProps
 * @property {string} label - Group heading.
 * @property {ReactNode} children - Group items.
 */
interface GroupProps {
  readonly label: string;
  readonly children: ReactNode;
}

/**
 * One labelled group of rail items.
 *
 * @param {GroupProps} props - Group props.
 * @returns {JSX.Element} The group.
 */
function Group({ label, children }: GroupProps) {
  return (
    <>
      <h2>{label}</h2>
      <ul aria-label={label}>{children}</ul>
    </>
  );
}

/**
 * Subsystem rail.
 *
 * @returns {JSX.Element} The rail.
 */
export function Rail() {
  const { violations, chrome, doctor, daemon } = useConsoleData();
  return (
    <nav aria-label='Subsystems'>
      <Group label='Enforce'>
        <li>
          <NavItem id='overview' icon={LayoutDashboard} label='Overview' />
        </li>
        <li>
          <NavItem
            id='violations'
            icon={TriangleAlert}
            label='Violations'
            count={violations.length}
            crit={violations.length > 0}
          />
        </li>
        <li>
          <NavItem id='gates' icon={ShieldCheck} label='Gates' count={chrome.gates} />
        </li>
      </Group>
      <Group label='Models'>
        <li>
          <NavItem id='roles' icon={Boxes} label='Roles' count={doctor.roles.length} />
        </li>
        <li>
          <NavItem id='keys' icon={KeyRound} label='Keys' count={chrome.keys} />
        </li>
        <li>
          <NavItem id='connectors' icon={Plug} label='Connectors' />
        </li>
      </Group>
      <Group label='Work'>
        <li>
          <NavItem id='swarm' icon={Workflow} label='Swarm' dot />
        </li>
        <li>
          <NavItem id='logs' icon={ScrollText} label='Logs' />
        </li>
      </Group>
      <footer>
        <dl>
          <dt>store</dt>
          <dd>{daemon.storeWriters} writer</dd>
          <dt>socket</dt>
          <dd>{daemon.socket}</dd>
          <dt>rss</dt>
          <dd>{daemon.rssMb} MB</dd>
          <dt>proto</dt>
          <dd>{daemon.proto}</dd>
        </dl>
      </footer>
    </nav>
  );
}
