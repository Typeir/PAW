/**
 * Rail
 *
 * @fileoverview The left rail: the subsystems grouped as PAW thinks of them —
 * Enforce, Models, Work — over a foot of daemon facts. It is a `nav` of real
 * lists under real headings, and the foot is a description list, because every
 * line in it is a labelled value; a screen reader can then walk the groups
 * instead of hearing an undifferentiated run of buttons. Counts come from the
 * snapshot, so an open violation is visible from anywhere in the console, and
 * the foot's socket and resident memory are the real ones the daemon reported.
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
 * @property {string} label - The group's heading.
 * @property {ReactNode} children - The group's items.
 */
interface GroupProps {
  readonly label: string;
  readonly children: ReactNode;
}

/**
 * One labelled group of rail items.
 *
 * @param {GroupProps} props - The group props.
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
 * The subsystem rail.
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
