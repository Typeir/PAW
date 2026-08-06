/**
 * Crumb Atom
 *
 * @fileoverview The heading every subsystem view opens with: the section name as
 * the page's one `h1`, with an optional monospace subtitle for the path or run
 * the view is showing.
 *
 * @module @paw/gui/presentation/atoms/crumb
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ReactNode } from 'react';

/**
 * Props for {@link Crumb}.
 *
 * @interface CrumbProps
 * @property {string} title - The section title.
 * @property {string} [sub] - An optional monospace subtitle.
 * @property {ReactNode} [children] - Controls that belong to the heading, e.g. a plan picker.
 */
export interface CrumbProps {
  readonly title: string;
  readonly sub?: string;
  readonly children?: ReactNode;
}

/**
 * A view heading.
 *
 * @param {CrumbProps} props - The crumb props.
 * @returns {JSX.Element} The heading.
 */
export function Crumb({ title, sub, children }: CrumbProps) {
  return (
    <header>
      <h1>{title}</h1>
      {children}
      {sub !== undefined && <span className='sub'>{sub}</span>}
    </header>
  );
}
