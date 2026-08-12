/**
 * Close Light Atom
 *
 * @fileoverview The console's one destructive-dismiss control: a red stoplight
 * disc with an always-visible ✕ glyph, the same design as the titlebar close.
 * Every remove, delete, dismiss, or close affordance renders this atom, so the
 * verb reads identically everywhere; green pips mark selection, red discs
 * remove.
 *
 * @module @paw/gui/presentation/atoms/closeLight
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { X } from 'lucide-react';

/**
 * Props for {@link CloseLight}.
 *
 * @interface CloseLightProps
 * @property {string} label - Accessible name; names what gets removed.
 * @property {() => void} onClick - Click handler.
 * @property {boolean} [small] - 14px disc for dense rows; default 17px.
 * @property {string} [className] - Extra class for layout placement.
 */
export interface CloseLightProps {
  readonly label: string;
  readonly onClick: () => void;
  readonly small?: boolean;
  readonly className?: string;
}

/**
 * Red stoplight disc that removes, deletes, dismisses, or closes.
 *
 * @param {CloseLightProps} props - The props.
 * @returns {JSX.Element} The button.
 */
export function CloseLight({ label, onClick, small = false, className }: CloseLightProps) {
  const classes = ['slight', 'close', small ? 'sm' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type='button' className={classes} aria-label={label} onClick={onClick}>
      <X size={small ? 9 : 10} strokeWidth={3} aria-hidden='true' />
    </button>
  );
}
