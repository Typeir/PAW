/**
 * PAW Console Style Mixins
 *
 * @fileoverview CSS fragments for the console stylesheet: the Ikuisuus SCSS
 * mixin vocabulary (focus ring, glow, transitions) as TS functions.
 * Interpolate into `consoleStyles.ts` rules.
 *
 * @module @paw/gui/presentation/styles/mixins
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Accent focus indicator for `:focus-visible` rules.
 *
 * @param {number} [offset] - Outline offset in px.
 * @returns {string} Outline declarations.
 */
export function focusRing(offset = 2): string {
  return `outline: 2px solid var(--accent); outline-offset: ${offset}px;`;
}

/**
 * One glow layer as a `drop-shadow()` value fragment, for composing inside a
 * `filter:` list next to `brightness()` or further shadows.
 *
 * @param {number} [px] - Glow radius in px.
 * @param {string} [color] - Glow colour.
 * @returns {string} The `drop-shadow(...)` value.
 */
export function dropShadow(px = 4, color = 'var(--accent)'): string {
  return `drop-shadow(0 0 ${px}px ${color})`;
}

/**
 * Whole-element glow as a complete `filter` declaration.
 *
 * @param {number} [px] - Glow radius in px.
 * @param {string} [color] - Glow colour.
 * @returns {string} The filter declaration.
 */
export function glow(px = 4, color = 'var(--accent)'): string {
  return `filter: ${dropShadow(px, color)};`;
}

/**
 * Transition declaration over the given properties, one shared duration and
 * easing so every control answers hover at the same speed.
 *
 * @param {...string} props - CSS properties to transition.
 * @returns {string} The transition declaration.
 */
export function smooth(...props: readonly string[]): string {
  return `transition: ${props.map((prop) => `${prop} .18s ease`).join(', ')};`;
}

/**
 * Text-only glow, for tabs and nav rows where a filter halo would bleed over
 * neighbours.
 *
 * @param {number} [px] - Glow radius in px.
 * @param {string} [color] - Glow colour.
 * @returns {string} The text-shadow declaration.
 */
export function textGlow(px = 6, color = 'var(--accent)'): string {
  return `text-shadow: 0 0 ${px}px ${color};`;
}

/**
 * Options for {@link punchyHover}.
 *
 * @interface PunchyHoverOptions
 * @property {number} [scale] - Hover scale factor.
 * @property {number} [glowPx] - Hover glow radius in px.
 * @property {string} [color] - Glow and border colour.
 * @property {boolean} [border] - Tint the element's border on hover.
 */
export interface PunchyHoverOptions {
  readonly scale?: number;
  readonly glowPx?: number;
  readonly color?: string;
  readonly border?: boolean;
}

/**
 * A control's whole hover feel in one call: transition, hover scale + glow
 * (and border tint), active press, disabled excluded, reduced-motion guard.
 * Emits complete rules for the selector.
 *
 * @param {string} selector - Selector to wire.
 * @param {PunchyHoverOptions} [options] - Feel overrides.
 * @returns {string} The rule block.
 */
export function punchyHover(selector: string, options: PunchyHoverOptions = {}): string {
  const { scale = 1.05, glowPx = 3, color = 'var(--accent)', border = true } = options;
  return `
${selector} { ${smooth('border-color', 'color', 'background', 'filter', 'transform')} }
${selector}:hover:not([disabled]) { transform: scale(${scale}); ${
    border ? `border-color: ${color}; ` : ''
  }filter: ${dropShadow(glowPx, color)}; }
${selector}:active:not([disabled]) { transform: scale(.97); }
@media (prefers-reduced-motion: reduce) {
  ${selector} { transition: none; }
  ${selector}:hover:not([disabled]), ${selector}:active:not([disabled]) { transform: none; }
}`;
}
