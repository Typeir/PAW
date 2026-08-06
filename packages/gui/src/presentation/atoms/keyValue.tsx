/**
 * Key/Value Atom
 *
 * @fileoverview A definition list for flat fact sheets — the host's pid, node
 * version, and working directory. A description list rather than a table
 * because these are labelled single facts, not rows of a set.
 *
 * @module @paw/gui/presentation/atoms/keyValue
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { Fragment, type ReactNode } from 'react';

/**
 * One labelled fact.
 *
 * @interface Fact
 * @property {string} label - The fact's name.
 * @property {ReactNode} value - The fact.
 */
export interface Fact {
  readonly label: string;
  readonly value: ReactNode;
}

/**
 * Props for {@link KeyValue}.
 *
 * @interface KeyValueProps
 * @property {readonly Fact[]} facts - The facts to list.
 */
export interface KeyValueProps {
  readonly facts: readonly Fact[];
}

/**
 * A fact sheet.
 *
 * @param {KeyValueProps} props - The list props.
 * @returns {JSX.Element} The definition list.
 */
export function KeyValue({ facts }: KeyValueProps) {
  return (
    <dl>
      {facts.map((fact) => (
        <Fragment key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
