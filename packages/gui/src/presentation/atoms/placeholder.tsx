/**
 * Placeholder Atom
 *
 * @fileoverview What a panel shows when there is genuinely nothing to show — no
 * open violations, or a subsystem a live control API has yet to back. It reads
 * as an empty state rather than as data, which is the point: the console never
 * fills a gap with a plausible number.
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
 * @property {ReactNode} children - The empty-state message.
 */
export interface PlaceholderProps {
  readonly children: ReactNode;
}

/**
 * An empty state.
 *
 * @param {PlaceholderProps} props - The placeholder props.
 * @returns {JSX.Element} The empty state.
 */
export function Placeholder({ children }: PlaceholderProps) {
  return <p className='placeholder'>{children}</p>;
}
