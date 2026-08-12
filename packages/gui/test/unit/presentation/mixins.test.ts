/**
 * Style Mixin Tests
 *
 * @fileoverview Cover the CSS mixin emitters: default and parameterised output
 * of the focus ring, glow layers, and transition groups, and their presence in
 * the composed stylesheet.
 *
 * @module @paw/gui/test/unit/presentation/mixins
 */

import { describe, expect, it } from 'vitest';
import {
  dropShadow,
  focusRing,
  glow,
  punchyHover,
  smooth,
  textGlow,
} from '../../../src/presentation/styles/mixins.js';
import { STYLES } from '../../../src/presentation/styles/consoleStyles.js';

describe('style mixins', () => {
  it('emits the accent focus ring, with and without an offset', () => {
    expect(focusRing()).toBe('outline: 2px solid var(--accent); outline-offset: 2px;');
    expect(focusRing(1)).toBe('outline: 2px solid var(--accent); outline-offset: 1px;');
  });

  it('emits glow layers as a filter value and as a whole declaration', () => {
    expect(dropShadow()).toBe('drop-shadow(0 0 4px var(--accent))');
    expect(dropShadow(6, '#e05c54')).toBe('drop-shadow(0 0 6px #e05c54)');
    expect(glow()).toBe('filter: drop-shadow(0 0 4px var(--accent));');
    expect(glow(3, 'red')).toBe('filter: drop-shadow(0 0 3px red);');
  });

  it('emits one transition declaration over every named property', () => {
    expect(smooth('filter')).toBe('transition: filter .18s ease;');
    expect(smooth('border-color', 'filter')).toBe(
      'transition: border-color .18s ease, filter .18s ease;',
    );
  });

  it('emits a text glow, with and without parameters', () => {
    expect(textGlow()).toBe('text-shadow: 0 0 6px var(--accent);');
    expect(textGlow(5, 'red')).toBe('text-shadow: 0 0 5px red;');
  });

  it('wires a whole hover feel from one call, defaults and overrides', () => {
    const wired = punchyHover('.btn');
    expect(wired).toContain(`.btn { ${smooth('border-color', 'color', 'background', 'filter', 'transform')} }`);
    expect(wired).toContain('.btn:hover:not([disabled]) { transform: scale(1.05); border-color: var(--accent); ');
    expect(wired).toContain(`filter: ${dropShadow(3)};`);
    expect(wired).toContain('.btn:active:not([disabled]) { transform: scale(.97); }');
    expect(wired).toContain('@media (prefers-reduced-motion: reduce)');

    const custom = punchyHover('.tab', { scale: 1.04, glowPx: 5, color: 'gold', border: false });
    expect(custom).toContain('transform: scale(1.04)');
    expect(custom).toContain('filter: drop-shadow(0 0 5px gold);');
    expect(custom).not.toContain('border-color: gold');
  });

  it('reaches the stylesheet: focus rings, stoplight glows, wired hovers', () => {
    expect(STYLES).toContain(focusRing());
    expect(STYLES).toContain(`brightness(1.12) ${dropShadow(6, 'var(--slight-c, #e05c54)')}`);
    expect(STYLES).toContain('.logfilter .chip:hover:not([disabled])');
    expect(STYLES).toContain('.btn:hover:not([disabled])');
    expect(STYLES).toContain('.tab:hover:not([disabled])');
    expect(STYLES).not.toContain('undefined');
  });
});
