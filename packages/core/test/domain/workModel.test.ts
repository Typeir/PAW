/**
 * Work Model Contract Tests
 *
 * @fileoverview The empty view every surface falls back to when a repository
 * has no module installed or no document to read.
 *
 * @module @paw/core/test/domain/workModel
 */

import { describe, expect, it } from 'vitest';
import { emptyWorkGraph, listRow } from '../../src/domain/workModel.js';

describe('emptyWorkGraph', () => {
  it('reports no rows and nothing recorded', () => {
    expect(emptyWorkGraph()).toEqual({ rows: [], refusals: [], loops: [], dangling: [] });
  });

  it('hands back a fresh value each call, so a caller cannot mutate the fallback', () => {
    expect(emptyWorkGraph()).not.toBe(emptyWorkGraph());
  });
});

describe('listRow', () => {
  const row = {
    id: 'op-1',
    title: 'Epic',
    parents: [],
    children: ['op-2'],
    depth: 0,
    rollup: 8,
    orphan: false,
    fields: { url: 'https://tracker.test/work_packages/1', points: 0 },
  };

  it('drops the field bag and keeps an http(s) url as the link', () => {
    expect(listRow(row)).toEqual({
      id: 'op-1',
      title: 'Epic',
      parents: [],
      children: ['op-2'],
      depth: 0,
      rollup: 8,
      orphan: false,
      link: 'https://tracker.test/work_packages/1',
    });
    expect(listRow({ ...row, fields: { url: 'http://localhost:18081/work_packages/1' } }).link).toBe(
      'http://localhost:18081/work_packages/1',
    );
  });

  it('gives no link for a missing, non-string, or non-http url, or a row from a module without fields', () => {
    for (const fields of [{}, { url: 7 }, { url: 'javascript:alert(1)' }, { url: 'file:///etc/passwd' }]) {
      expect(listRow({ ...row, fields }).link).toBeNull();
    }
    const { fields: _dropped, ...older } = row;
    expect(listRow(older as unknown as typeof row).link).toBeNull();
  });
});
