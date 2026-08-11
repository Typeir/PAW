/**
 * Nav Item Atom
 *
 * @fileoverview Rail entry. Reads active section and nav action from
 * context. Active item sets `aria-current`. Clicking calls goto(id).
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
 * @property {Section} id - Section this item pick.
 * @property {LucideIcon} icon - Leading icon component.
 * @property {string} label - Item label.
 * @property {number} [count] - Trailing count.
 * @property {boolean} [crit] - Colour count critical.
 * @property {boolean} [dot] - Show active dot, no count.
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
 * Rail navigation item.
 *
 * @param {NavItemProps} props - Item props.
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
