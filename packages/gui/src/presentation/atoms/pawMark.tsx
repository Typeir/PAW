/**
 * Paw Mark Atom
 *
 * @fileoverview Wordmark glyph. Inline SVG. Page self-contained, strict CSP
 * fetch no image. Decorative. Hide from accessibility tree — wordmark text
 * carry name.
 *
 * @module @paw/gui/presentation/atoms/pawMark
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * The paw glyph.
 *
 * @returns {JSX.Element} Inline mark.
 */
export function PawMark() {
  return (
    <span className='mark' aria-hidden='true'>
      <svg width='13' height='13' viewBox='0 0 13 13' fill='none'>
        <circle cx='3' cy='3.4' r='1.5' fill='var(--accent)' />
        <circle cx='6.5' cy='2.4' r='1.5' fill='var(--accent)' />
        <circle cx='10' cy='3.4' r='1.5' fill='var(--accent)' />
        <path
          d='M6.5 6C4.6 6 3 7.4 3 9c0 1.6 1.4 2 3.5 2S10 10.6 10 9c0-1.6-1.6-3-3.5-3Z'
          fill='var(--accent)'
        />
      </svg>
    </span>
  );
}
