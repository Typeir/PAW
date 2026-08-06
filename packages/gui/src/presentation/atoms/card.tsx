/**
 * Card Atom
 *
 * @fileoverview The console's one panel container: a bordered surface with an
 * optional header carrying a title on the left and a monospace meta note on the
 * right. Every view in the console is built from these, so the chrome is defined
 * once and a new panel cannot drift from the instrument-panel look.
 *
 * @module @paw/gui/presentation/atoms/card
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ReactNode } from 'react';

/**
 * Props for {@link Card}.
 *
 * @interface CardProps
 * @property {string} [title] - The header title; omit for a headerless card.
 * @property {ReactNode} [meta] - The right-aligned header note.
 * @property {string} [variant] - An extra class, e.g. `preview`.
 * @property {ReactNode} children - The card body.
 */
export interface CardProps {
  readonly title?: string;
  readonly meta?: ReactNode;
  readonly variant?: string;
  readonly children: ReactNode;
}

/**
 * A bordered panel with an optional header.
 *
 * @param {CardProps} props - The card props.
 * @returns {JSX.Element} The card.
 */
export function Card({ title, meta, variant, children }: CardProps) {
  return (
    <section className={variant === undefined ? 'card' : `card ${variant}`}>
      {title !== undefined && (
        <header>
          <h2>{title}</h2>
          {meta !== undefined && <span className='meta'>{meta}</span>}
        </header>
      )}
      {children}
    </section>
  );
}
