/**
 * Figure Atom
 *
 * @fileoverview Big tabular number over small caption, used for budget card
 * token counts and spend. Cost variant right-aligns and applies a distinct
 * colour; the card shows two inputs on the left and their cost on the right.
 *
 * @module @paw/gui/presentation/atoms/figure
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Figure props. Pass to {@link Figure}.
 *
 * @interface FigureProps
 * @property {string} value - The figure.
 * @property {string} caption - Caption beneath it.
 * @property {boolean} [cost] - Render as trailing cost figure.
 */
export interface FigureProps {
  readonly value: string;
  readonly caption: string;
  readonly cost?: boolean;
}

/**
 * Captioned figure.
 *
 * @param {FigureProps} props - The figure props.
 * @returns {JSX.Element} The figure.
 */
export function Figure({ value, caption, cost }: FigureProps) {
  return (
    <figure className={cost === true ? 'cost' : undefined}>
      <span className='big'>{value}</span>
      <figcaption className='cap'>{caption}</figcaption>
    </figure>
  );
}
