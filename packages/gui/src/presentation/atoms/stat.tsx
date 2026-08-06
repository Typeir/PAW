/**
 * Stat Atom
 *
 * @fileoverview One cell of a stat strip: a small upper-case label over a large
 * tabular figure, optionally toned good or critical. A stat is a labelled value,
 * so it is a `dt`/`dd` pair inside the strip's description list rather than two
 * anonymous divs. The figure is a node rather than a string so a cell can carry a
 * trailing qualifier (`17 / 374 skipped`) without a second component.
 *
 * @module @paw/gui/presentation/atoms/stat
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ReactNode } from 'react';

/**
 * The semantic tone of a figure.
 */
export type StatTone = 'ok' | 'crit';

/**
 * Props for {@link Stat}.
 *
 * @interface StatProps
 * @property {string} label - The stat label.
 * @property {ReactNode} value - The figure.
 * @property {StatTone} [tone] - Optional semantic tone.
 */
export interface StatProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly tone?: StatTone;
}

/**
 * A labelled figure.
 *
 * @param {StatProps} props - The stat props.
 * @returns {JSX.Element} The stat cell.
 */
export function Stat({ label, value, tone }: StatProps) {
  return (
    <div className='stat'>
      <dt className='lbl'>{label}</dt>
      <dd className={tone === undefined ? 'val' : `val ${tone}`}>{value}</dd>
    </div>
  );
}
