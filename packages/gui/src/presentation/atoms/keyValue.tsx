/**
 * Key/Value Atom
 *
 * @fileoverview Definition list for flat fact sheets — host pid, node version,
 * working directory. Description list not table, cause these single labelled
 * fact, not row of set.
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
 * @property {string} label - Fact name.
 * @property {ReactNode} value - Fact.
 */
export interface Fact {
  readonly label: string;
  readonly value: ReactNode;
}

/**
 * Props for {@link KeyValue}.
 *
 * @interface KeyValueProps
 * @property {readonly Fact[]} facts - Facts to list.
 */
export interface KeyValueProps {
  readonly facts: readonly Fact[];
}

/**
 * Fact sheet.
 *
 * @param {KeyValueProps} props - List props.
 * @returns {JSX.Element} Definition list.
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
