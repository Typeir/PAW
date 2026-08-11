/**
 * @fileoverview Unit tests for project-path normalisation. Stop absolute host
 * paths doubling against root. Pin: absolute path under root (case-insensitively,
 * with trailing slash) become relative; already-relative path and one outside
 * root stay unchanged; root itself be `.`.
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
