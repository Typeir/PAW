/**
 * Card Atom
 *
 * @fileoverview Console one panel container. Bordered surface with optional
 * header. Title sit left, monospace meta note sit right. Every console view build
 * from these. Card chrome defined once and shared by every panel.
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
 * @property {string} [title] - Header title. Omit for headerless card.
 * @property {ReactNode} [meta] - Right-aligned header note.
 * @property {string} [variant] - Extra class, e.g. `preview`.
 * @property {ReactNode} children - Card body.
 */
export interface CardProps {
  readonly title?: string;
  readonly meta?: ReactNode;
  readonly variant?: string;
  readonly children: ReactNode;
}

/**
 * Bordered panel with optional header.
 *
 * @param {CardProps} props - Card props.
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
