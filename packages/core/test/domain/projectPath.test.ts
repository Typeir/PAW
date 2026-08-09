/**
 * @fileoverview Unit tests for project-path normalisation — the fix for absolute
 * host paths doubling against the root. They pin: an absolute path under the root
 * (case-insensitively, with a trailing slash) becomes relative; an already-
 * relative path and one outside the root are left alone; the root itself is `.`.
 *
 * @module @paw/core/test/domain/projectPath
 */

import { describe, expect, it } from 'vitest';
import { toProjectRelative } from '../../src/index.js';

describe('toProjectRelative', () => {
  it('maps an absolute path under the root to relative, case-insensitively', () => {
    expect(toProjectRelative('C:/Users/x/repo', 'c:\\Users\\x\\repo\\src\\a.ts')).toBe('src/a.ts');
  });

  it('tolerates a trailing slash on the root', () => {
    expect(toProjectRelative('C:/repo/', 'C:/repo/src/a.ts')).toBe('src/a.ts');
  });

  it('leaves an already-relative path unchanged', () => {
    expect(toProjectRelative('C:/repo', 'src/a.ts')).toBe('src/a.ts');
  });

  it('returns "." for the root itself', () => {
    expect(toProjectRelative('C:/repo', 'C:/repo')).toBe('.');
  });

  it('leaves a path outside the root unchanged', () => {
    expect(toProjectRelative('C:/repo', 'D:/other/a.ts')).toBe('D:/other/a.ts');
  });
});
