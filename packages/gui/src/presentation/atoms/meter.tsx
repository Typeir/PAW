/**
 * Meter Atom
 *
 * @fileoverview Segmented bar. Show run split across plan members — skipped,
 * done, running, failed — as width of whole. Segment width is share of total.
 *
 * @module @paw/gui/presentation/atoms/meter
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * One segment of meter.
 *
 * @interface Segment
 * @property {string} name - Stable key, e.g. `done`.
 * @property {number} value - Part this segment represent.
 * @property {string} colorVar - CSS custom property fill it with.
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
 * @property {readonly Segment[]} segments - Segments, in draw order.
 * @property {number} total - Whole the segments share of.
 */
export interface MeterProps {
  readonly segments: readonly Segment[];
  readonly total: number;
}

/**
 * Percentage of total. Safe when total zero.
 *
 * @param {number} value - The part.
 * @param {number} total - The whole.
 * @returns {number} `value/total*100`, or 0 when total 0.
 */
export function pct(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}

/**
 * Segmented progress bar.
 *
 * @param {MeterProps} props - Meter props.
 * @returns {JSX.Element} Bar.
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
