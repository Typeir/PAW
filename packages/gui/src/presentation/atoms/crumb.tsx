/**
 * Crumb Atom
 *
 * @fileoverview Heading open every subsystem view. Section name be page one `h1`. Optional monospace subtitle show path or run in view.
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
 * @property {string} title - Section title.
 * @property {string} [sub] - Optional monospace subtitle.
 * @property {ReactNode} [children] - Controls belong to heading, e.g. plan picker.
 */
export interface CrumbProps {
  readonly title: string;
  readonly sub?: string;
  readonly children?: ReactNode;
}

/**
 * View heading.
 *
 * @param {CrumbProps} props - Crumb props.
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
