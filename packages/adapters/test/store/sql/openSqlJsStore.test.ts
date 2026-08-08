/**
 * @fileoverview The test that matters for enforcement: violations survive a
 * restart. It opens a disk-backed store, raises a violation, opens a SECOND store
 * from the same file (a reopen, as pawd would after a restart) and finds it still
 * there, then resolves it and confirms a third open sees it gone. Covers both the
 * fresh-create and read-existing branches of `openSqlJsStore`.
 *
 * @module @paw/adapters/test/store/sql/openSqlJsStore
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSqlJsStore } from '../../../src/index.js';

describe('openSqlJsStore', () => {
  it('persists violations across a reopen, and their resolution', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paw-store-'));
    const dbPath = join(dir, '.paw', 'paw.sqlite');
    try {
      const first = await openSqlJsStore(dbPath);
      await first.raise(
        [{ id: 0, filePath: 'src/a.ts', rule: 'no-bad', message: 'BADCODE', indirectFix: false }],
        'S',
      );

      const reopened = await openSqlJsStore(dbPath);
      const survived = await reopened.unresolvedFor('S');
      expect(survived).toHaveLength(1);
      expect(survived[0]).toMatchObject({ filePath: 'src/a.ts', rule: 'no-bad' });

      await reopened.resolveForFile('src/a.ts', 'S');

      const afterFix = await openSqlJsStore(dbPath);
      expect(await afterFix.unresolvedFor('S')).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
