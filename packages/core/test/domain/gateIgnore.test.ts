/**
 * PAW Gate-Ignore Tests
 *
 * @fileoverview Exercises every branch of the directive parser and the
 * suppression query — all three comment styles, file-level vs next-line,
 * gate and rule wildcards, dash-insensitive id matching, and the non-match
 * paths — so `gateIgnore.ts` reaches 100%.
 *
 * @module @paw/core/test/domain/gateIgnore
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import {
  isSuppressed,
  parseIgnoreDirectives,
} from '../../src/domain/gateIgnore.js';

describe('parseIgnoreDirectives + isSuppressed', () => {
  it('suppresses a whole gate for the file via a block comment', () => {
    const d = parseIgnoreDirectives('/* paw:gate:jsdoc ignore */\nexport const x = 1;');
    expect(isSuppressed(d, 'jsdoc', 'missing')).toBe(true);
    expect(isSuppressed(d, 'other', 'missing')).toBe(false);
  });

  it('suppresses only the named rule when a rule is given', () => {
    const d = parseIgnoreDirectives('/* paw:gate:antipatterns:console-log ignore */');
    expect(isSuppressed(d, 'antipatterns', 'console-log')).toBe(true);
    expect(isSuppressed(d, 'antipatterns', 'other-rule')).toBe(false);
  });

  it('reads an MDX JSX comment', () => {
    const d = parseIgnoreDirectives('{/* paw:gate:content-format:missing-h1 ignore */}');
    expect(isSuppressed(d, 'content-format', 'missing-h1')).toBe(true);
  });

  it('reads an HTML comment', () => {
    const d = parseIgnoreDirectives('<!-- paw:gate:mdx ignore -->');
    expect(isSuppressed(d, 'mdx', 'anything')).toBe(true);
  });

  it('honours the gate wildcard', () => {
    const d = parseIgnoreDirectives('/* paw:gate:* ignore */');
    expect(isSuppressed(d, 'whatever', 'whatever')).toBe(true);
  });

  it('honours the rule wildcard', () => {
    const d = parseIgnoreDirectives('/* paw:gate:jsdoc:* ignore */');
    expect(isSuppressed(d, 'jsdoc', 'any-rule')).toBe(true);
  });

  it('matches gate ids dash-insensitively', () => {
    const d = parseIgnoreDirectives('/* paw:gate:filelength ignore */');
    expect(isSuppressed(d, 'file-length', 'max-lines')).toBe(true);
  });

  it('applies ignore-nextline to the following line only', () => {
    const d = parseIgnoreDirectives('/* paw:gate:jsdoc ignore-nextline */\nconst y = 2;');
    expect(isSuppressed(d, 'jsdoc', 'missing', 2)).toBe(true);
    expect(isSuppressed(d, 'jsdoc', 'missing', 3)).toBe(false);
  });

  it('does not match a next-line directive whose gate differs', () => {
    const d = parseIgnoreDirectives('/* paw:gate:jsdoc ignore-nextline */\nconst z = 3;');
    expect(isSuppressed(d, 'antipatterns', 'x', 2)).toBe(false);
  });

  it('returns false when nothing is suppressed and no line is given', () => {
    const d = parseIgnoreDirectives('const noDirectives = true;');
    expect(isSuppressed(d, 'jsdoc', 'missing')).toBe(false);
    expect(isSuppressed(d, 'jsdoc', 'missing', 5)).toBe(false);
  });
});
