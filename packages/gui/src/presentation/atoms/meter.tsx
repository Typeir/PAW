/**
 * Meter Atom
 *
 * @fileoverview The segmented bar that shows a run's split across the plan's
 * members — skipped, done, running, failed — as widths of the whole. Segment
 * widths are a share of the total rather than of what has been dispatched, so a
 * run that has barely started reads as barely started.
 *
 * @module @paw/gui/presentation/atoms/meter
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * One segment of a meter.
 *
 * @interface Segment
 * @property {string} name - A stable key, e.g. `done`.
 * @property {number} value - The part this segment represents.
 * @property {string} colorVar - The CSS custom property to fill it with.
 */
export interface Segment {
  readonly name: string;
  readonly value: number;
  readonly colorVar: string;
}

/**
 * Props for {@link Meter}.
 *
 * @interface MeterProps
 * @property {readonly Segment[]} segments - The segments, in draw order.
 * @property {number} total - The whole the segments are shares of.
 */
export interface MeterProps {
  readonly segments: readonly Segment[];
  readonly total: number;
}

/**
 * A percentage of a total, safe when the total is zero.
 *
 * @param {number} value - The part.
 * @param {number} total - The whole.
 * @returns {number} `value/total*100`, or 0 when the total is 0.
 */
export function pct(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}

/**
 * A segmented progress bar.
 *
 * @param {MeterProps} props - The meter props.
 * @returns {JSX.Element} The bar.
 */
export function Meter({ segments, total }: MeterProps) {
  return (
    <span className='mini' aria-hidden='true'>
      {segments.map((seg) => (
        <i
          key={seg.name}
          data-seg={seg.name}
          style={{ width: `${pct(seg.value, total).toFixed(2)}%`, background: `var(${seg.colorVar})` }}
        />
      ))}
    </span>
  );
}
