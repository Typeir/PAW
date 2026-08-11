/**
 * PAW Installer Repo Tests.
 *
 * @fileoverview Cover `findRepoRoot` find `.git` up tree and return null at
 * filesystem root. Make `repo.ts` reach 100%.
 *
 * @module @paw/installer/test/repo
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '../src/repo.js';

describe('findRepoRoot', () => {
  it('walks up to the nearest ancestor containing .git', () => {
    const root = '/work/repo';
    const found = findRepoRoot('/work/repo/packages/a/src', (p) => p === join(root, '.git'));
    expect(found).toBe(root);
  });

  it('returns null when no .git is found up to the filesystem root', () => {
    expect(findRepoRoot('/work/loose/dir', () => false)).toBeNull();
  });
});
