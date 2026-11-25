/**
 * PAW Line File Tests
 *
 * @fileoverview Cover `withLines`: append missing lines once, keep existing text.
 *
 * @module @paw/core/test/domain/lineFile
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { withLines } from '../../src/domain/lineFile.js';

describe('withLines', () => {
  it('writes every line into an empty file, newline-terminated', () => {
    expect(withLines('', ['a', 'b'])).toBe('a\nb\n');
  });

  it('appends only the missing lines, after the existing text', () => {
    expect(withLines('mine\na\n', ['a', 'b'])).toBe('mine\na\nb\n');
  });

  it('terminates an unterminated last line before appending', () => {
    expect(withLines('mine', ['b'])).toBe('mine\nb\n');
  });

  it('returns the text unchanged when every line is present', () => {
    expect(withLines('a\nb', ['a', 'b'])).toBe('a\nb');
  });
});
