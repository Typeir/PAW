/**
 * Button Atom
 *
 * @fileoverview Console button. Controls live `pawd` drive; renders disabled
 * when no drive responds. Reason displays on {@link Tooltip} wrapper, not browser
 * `title` — the tooltip inherits existing styles and fires even over a disabled
 * button.
 *
 * @module @paw/gui/presentation/atoms/button
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ReactNode } from 'react';

/**
 * Props for {@link Button}.
 *
 * @interface ButtonProps
 * @property {boolean} [primary] - Render in accent (primary) treatment.
 * @property {boolean} [disabled] - Disable control.
 * @property {string} [align] - Extra class, e.g. `push`. Shifts button right.
 * @property {() => void} [onClick] - Click handler.
 * @property {ReactNode} children - Label.
 */
export interface ButtonProps {
  readonly primary?: boolean;
  readonly disabled?: boolean;
  readonly align?: string;
  readonly onClick?: () => void;
  readonly children: ReactNode;
}

/**
 * Console button.
 *
 * @param {ButtonProps} props - Button props.
 * @returns {JSX.Element} Button.
 */
export function Button({ primary, disabled, align, onClick, children }: ButtonProps) {
  const classes = ['btn'];
  if (primary === true) {
    classes.push('pri');
  }
  if (align !== undefined) {
    classes.push(align);
  }
  return (
    <button type='button' className={classes.join(' ')} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
