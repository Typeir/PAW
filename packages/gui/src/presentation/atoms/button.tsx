/**
 * Button Atom
 *
 * @fileoverview The console's button. A control that a running `pawd` would drive
 * but nothing yet backs is rendered disabled, with the reason carried by a
 * {@link Tooltip} wrapper rather than a browser `title` — the console shows what
 * exists and says plainly what does not, in something it can actually style and
 * that fires even over a disabled control.
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
 * @property {boolean} [primary] - Render in the accent (primary) treatment.
 * @property {boolean} [disabled] - Disable the control.
 * @property {string} [align] - An extra class, e.g. `push` to shove it right.
 * @property {() => void} [onClick] - The click handler.
 * @property {ReactNode} children - The label.
 */
export interface ButtonProps {
  readonly primary?: boolean;
  readonly disabled?: boolean;
  readonly align?: string;
  readonly onClick?: () => void;
  readonly children: ReactNode;
}

/**
 * A console button.
 *
 * @param {ButtonProps} props - The button props.
 * @returns {JSX.Element} The button.
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
