/**
 * Figure Atom
 *
 * @fileoverview A large tabular number over a small caption — the budget card's
 * token counts and its spend. The cost variant right-aligns and takes the good
 * colour, which is how the card reads at a glance: two inputs on the left, what
 * they cost on the right.
 *
 * @module @paw/gui/presentation/atoms/figure
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Props for {@link Figure}.
 *
 * @interface FigureProps
 * @property {string} value - The figure.
 * @property {string} caption - The caption beneath it.
 * @property {boolean} [cost] - Render as the trailing cost figure.
 */
export interface FigureProps {
  readonly value: string;
  readonly caption: string;
  readonly cost?: boolean;
}

/**
 * A captioned figure.
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
