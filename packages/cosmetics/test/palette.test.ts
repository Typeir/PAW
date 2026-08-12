/**
 * @fileoverview Cover the semantic palette: every token carries its meaning's
 * emphasis and hue, ANSI painters open with the exact escape and always reset,
 * a hue-less token styles emphasis only, and the CSS block names one variable
 * per colored token with its hex twin.
 *
 * @module @paw/cosmetics/test/palette
 */

import { describe, expect, it } from 'vitest';
import { PALETTE, ansiOpen, ansiPaint, cssVariables } from '../src/index.js';

describe('PALETTE', () => {
  it('pairs every colored token with a hex twin, and hue-less tokens with none', () => {
    for (const token of Object.values(PALETTE)) {
      expect(token.xterm === null).toBe(token.hex === null);
    }
  });

  it('keeps concept and event on the same hue, event bold', () => {
    expect(PALETTE.concept.xterm).toBe(PALETTE.event.xterm);
    expect(PALETTE.concept.bold).toBe(false);
    expect(PALETTE.event.bold).toBe(true);
  });
});

describe('ansiOpen', () => {
  it('composes bold, italic, and color into one escape', () => {
    expect(ansiOpen(PALETTE.event)).toBe('\x1b[1;38;5;73m');
    expect(ansiOpen(PALETTE.param)).toBe('\x1b[3;38;5;108m');
    expect(ansiOpen(PALETTE.flag)).toBe('\x1b[38;5;245m');
    expect(ansiOpen(PALETTE.verb)).toBe('\x1b[1m');
  });

  it('is empty for a token with no styling at all', () => {
    expect(ansiOpen({ xterm: null, hex: null, bold: false, italic: false })).toBe('');
  });
});

describe('ansiPaint', () => {
  it('wraps text in the token style and a reset, per token', () => {
    expect(ansiPaint.verb('swarm')).toBe('\x1b[1mswarm\x1b[0m');
    expect(ansiPaint.optional('[--dry-run]')).toBe('\x1b[3;38;5;179m[--dry-run]\x1b[0m');
    expect(ansiPaint.tech('TLS')).toBe('\x1b[38;5;175mTLS\x1b[0m');
    expect(ansiPaint.concept('pawd')).toBe('\x1b[38;5;73mpawd\x1b[0m');
  });
});

describe('cssVariables', () => {
  it('emits one --sem variable per colored token, skipping hue-less ones', () => {
    const css = cssVariables();
    expect(css).toContain('--sem-param: #87af87;');
    expect(css).toContain('--sem-optional: #d7af5f;');
    expect(css).toContain('--sem-concept: #5fafaf;');
    expect(css).toContain('--sem-tech: #d787af;');
    expect(css).toContain('--sem-flag: #8a8a8a;');
    expect(css).not.toContain('--sem-verb');
  });
});
