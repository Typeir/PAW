/**
 * Console Stylesheet Tests
 *
 * @fileoverview Cover the compiled console stylesheet: the palette prefix, theme tokens, and the output
 * of the SCSS mixins (focus ring, glow, transitions, control hover) at their call sites.
 *
 * @module @paw/gui/test/unit/presentation/styles
 */

import { cssVariables } from '@paw/cosmetics';
import { describe, expect, it } from 'vitest';
import { STYLES } from '../../../src/presentation/styles/consoleStyles.js';

/**
 * Body of the first rule whose whole selector is `selector`.
 *
 * @param {string} selector - Selector as compiled.
 * @returns {string} Declarations between the braces; empty when no such rule exists.
 */
function body(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*${escaped} \\{([^}]*)\\}`, 'm').exec(STYLES)?.[1] ?? '';
}

describe('console stylesheet', () => {
  it('leads with the shared semantic palette', () => {
    expect(STYLES.startsWith(`:root {\n${cssVariables()}\n}\n`)).toBe(true);
  });

  it('defines dark and light tokens under the media query and the explicit theme', () => {
    expect(STYLES).toContain('@media (prefers-color-scheme: light)');
    expect(body(':root[data-theme=dark]')).toContain('--accent: #e79a3c;');
    expect(body(':root[data-theme=light]')).toContain('--accent: #a9631a;');
  });

  it('emits the accent focus ring at each offset', () => {
    expect(body('.btn:focus-visible')).toContain('outline: 2px solid var(--accent);');
    expect(body('.btn:focus-visible')).toContain('outline-offset: 2px;');
    expect(body('.planname:focus-visible')).toContain('outline-offset: 1px;');
    expect(body('.navitem:focus-visible')).toContain('outline-offset: -2px;');
  });

  it('emits glows, text glows, and grouped transitions', () => {
    expect(body('.slight:hover')).toContain(
      'filter: brightness(1.12) drop-shadow(0 0 6px var(--slight-c, #e05c54));',
    );
    expect(body('.navitem:hover')).toContain('text-shadow: 0 0 5px var(--accent);');
    expect(body('.navitem')).toContain(
      'transition: background 0.18s ease, color 0.18s ease, text-shadow 0.18s ease;',
    );
  });

  it('wires the control hover with defaults and overrides', () => {
    const toggle = body('.theme-toggle:hover:not([disabled])');
    expect(toggle).toContain('transform: scale(1.05);');
    expect(toggle).toContain('border-color: var(--accent);');
    expect(toggle).toContain('filter: drop-shadow(0 0 3px var(--accent));');
    expect(body('.btn:hover:not([disabled])')).toContain('transform: scale(1.04);');
    expect(body('.tab:hover:not([disabled])')).toContain('transform: scale(1.04);');
    expect(body('.tab:hover:not([disabled])')).not.toContain('border-color');
    expect(body('.btn:active:not([disabled])')).toContain('transform: scale(0.97);');
    expect(STYLES).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('leaves no unresolved Sass in the output', () => {
    expect(STYLES).not.toMatch(/undefined|#\{|\$[a-z]/);
  });
});
