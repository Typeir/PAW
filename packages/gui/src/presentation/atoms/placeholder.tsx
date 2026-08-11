/**
 * Placeholder Atom
 *
 * @fileoverview Panel show when no genuine content exist — no open violations,
 * no subsystem for live control API yet. Read as empty state, not data. Point:
 * console never fill gap with fake number.
 *
 * @module @paw/gui/presentation/atoms/placeholder
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ReactNode } from 'react';

/**
 * Props for {@link Placeholder}.
 *
 * @interface PlaceholderProps
 * @property {ReactNode} children - Empty-state message.
 */
export interface PlaceholderProps {
  readonly children: ReactNode;
}

/**
 * Empty state.
 *
 * @param {PlaceholderProps} props - Placeholder props.
 * @returns {JSX.Element} Empty state.
 */
export function Placeholder({ children }: PlaceholderProps) {
  return <p className='placeholder'>{children}</p>;
}
