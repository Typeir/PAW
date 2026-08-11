/**
 * Stat Atom
 *
 * @fileoverview One cell of stat strip: small upper-case label over large
 * tabular figure, toned good or critical. Stat be labelled value, so it be
 * `dt`/`dd` pair inside strip's description list, not two anonymous divs. Figure
 * be node, not string, so cell carry trailing qualifier (`17 / 374 skipped`)
 * without second component.
 *
 * @module @paw/gui/presentation/atoms/stat
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ReactNode } from 'react';

/**
 * Semantic tone of figure.
 */
export type StatTone = 'ok' | 'crit';

/**
 * Props for {@link Stat}.
 *
 * @interface StatProps
 * @property {string} label - Stat label.
 * @property {ReactNode} value - Figure.
 * @property {StatTone} [tone] - Optional semantic tone.
 */
export interface StatProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly tone?: StatTone;
}

/**
 * Labelled figure.
 *
 * @param {StatProps} props - Stat props.
 * @returns {JSX.Element} Stat cell.
 */
export function Stat({ label, value, tone }: StatProps) {
  return (
    <div className='stat'>
      <dt className='lbl'>{label}</dt>
      <dd className={tone === undefined ? 'val' : `val ${tone}`}>{value}</dd>
    </div>
  );
}
