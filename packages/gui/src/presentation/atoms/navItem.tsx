/**
 * Nav Item Atom
 *
 * @fileoverview A rail entry. It reads the active section and the navigation
 * action straight from context, so the rail is a list of what exists rather than
 * a component that threads selection state and a callback down from the shell.
 * The active item carries `aria-current`, so the rail announces where the
 * operator is rather than only colouring it.
 *
 * @module @paw/gui/presentation/atoms/navItem
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { LucideIcon } from 'lucide-react';
import { useConsoleActions } from '../../application/hooks/useConsoleActions.js';
import { useSection } from '../../application/hooks/useConsole.js';
import type { Section } from '../../domain/console.types.js';

/**
 * Props for {@link NavItem}.
 *
 * @interface NavItemProps
 * @property {Section} id - The section this item selects.
 * @property {LucideIcon} icon - The leading icon component.
 * @property {string} label - The item label.
 * @property {number} [count] - A trailing count.
 * @property {boolean} [crit] - Colour the count critical.
 * @property {boolean} [dot] - Show an active dot instead of a count.
 */
export interface NavItemProps {
  readonly id: Section;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly count?: number;
  readonly crit?: boolean;
  readonly dot?: boolean;
}

/**
 * A rail navigation item.
 *
 * @param {NavItemProps} props - The item props.
 * @returns {JSX.Element} The item.
 */
export function NavItem({ id, icon: Icon, label, count, crit, dot }: NavItemProps) {
  const section = useSection();
  const { goto } = useConsoleActions();
  const on = section === id;
  return (
    <button
      type='button'
      className={on ? 'navitem on' : 'navitem'}
      aria-current={on ? 'page' : undefined}
      onClick={() => goto(id)}>
      <span className='ico' aria-hidden='true'>
        <Icon size={15} strokeWidth={2} />
      </span>{' '}
      {label}{' '}
      {dot === true && (
        <>
          <span className='dot' aria-hidden='true' />
          <span className='vh'>active</span>
        </>
      )}
      {dot !== true && count !== undefined && (
        <span className={crit === true ? 'n crit' : 'n'}>{count}</span>
      )}
    </button>
  );
}
