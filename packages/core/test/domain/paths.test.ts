/**
 * PAW Path Text Tests
 *
 * @fileoverview Pins the string handling core does instead of importing
 * `node:path`, which it cannot: `@paw/gui` compiles core for the browser, where
 * a `node:` import fails the build. These are the cases that stopped it being a
 * one-liner — a bare filename, a path at the root, and both separators.
 *
 * @module @paw/core/test/domain/paths
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { dirNameOf, joinPath } from '../../src/domain/paths.js';

describe('joinPath', () => {
  it('joins with forward slashes', () => {
    expect(joinPath(['/repo', '.paw', 'config.json'])).toBe('/repo/.paw/config.json');
  });

  it('normalises backslashes so a Windows root joins cleanly', () => {
    expect(joinPath(['C:\\Users\\x', '.paw'])).toBe('C:/Users/x/.paw');
  });

  it('drops empty segments and trailing separators', () => {
    expect(joinPath(['/repo/', '', '.git', 'hooks/'])).toBe('/repo/.git/hooks');
    expect(joinPath([])).toBe('');
  });
});

describe('dirNameOf', () => {
  it('gives the directory a path sits in', () => {
    expect(dirNameOf('/repo/.paw/config.json')).toBe('/repo/.paw');
  });

  it('treats backslashes the same', () => {
    expect(dirNameOf('C:\\Users\\x\\config.json')).toBe('C:/Users/x');
  });

  it('gives nothing for a bare filename', () => {
    expect(dirNameOf('config.json')).toBe('');
  });

  it('gives nothing at the root, rather than a stray separator', () => {
    expect(dirNameOf('/config.json')).toBe('');
  });
});
