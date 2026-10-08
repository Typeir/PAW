/**
 * Work Model Tests
 *
 * @fileoverview Cover the module's implementation of the work-model contract:
 * `view` renders rows, refusals, loops, and dangling edges from document text;
 * `detail` renders one task with its relatives, or null for an unknown id.
 *
 * @module @paw/agile/test/workModel
 */

import { describe, expect, it } from 'vitest';
import { workModel } from '../src/workModel.js';

/** a → b, b → c, c → a closes a ring; ghost → b names an absent task; one entry has no id. */
const DOCUMENT = JSON.stringify({
  tasks: [
    { id: 'a', title: 'A', fields: { points: 1 } },
    { id: 'b', title: 'B', fields: { points: 2 } },
    { id: 'c', title: 'C', fields: { points: 3 } },
    { title: 'no id' },
  ],
  edges: [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'a'],
    ['ghost', 'b'],
  ],
});

describe('workModel.view', () => {
  it('renders every row with its rollup, and declares the ring and the dangling edge', () => {
    const view = workModel.view(DOCUMENT, 'points');
    expect(view.rows.map((row) => [row.id, row.depth, row.rollup])).toEqual([
      ['a', 0, 6],
      ['b', 1, 5],
      ['c', 2, 3],
    ]);
    expect(view.loops).toEqual([{ parent: 'c', child: 'a' }]);
    expect(view.dangling).toEqual([{ parent: 'ghost', child: 'b' }]);
    expect(view.rows.find((row) => row.id === 'b')?.orphan).toBe(true);
  });

  it('carries the parser refusals beside the rows', () => {
    const view = workModel.view(DOCUMENT, 'points');
    expect(view.refusals).toHaveLength(1);
    expect(view.refusals[0]).toContain('id');
  });

  it('renders an empty document as no rows and no refusals', () => {
    expect(workModel.view('', 'points')).toEqual({
      rows: [],
      refusals: [],
      loops: [],
      dangling: [],
    });
  });
});

describe('workModel.detail', () => {
  it('renders one task with its ancestors and descendants', () => {
    const detail = workModel.detail(DOCUMENT, 'b', 'points');
    expect(detail?.row.id).toBe('b');
    expect(detail?.ancestors.map((row) => row.id)).toEqual(['a']);
    expect(detail?.descendants.map((row) => row.id)).toEqual(['c']);
  });

  it('answers null for a task the document does not hold', () => {
    expect(workModel.detail(DOCUMENT, 'ghost', 'points')).toBeNull();
  });
});
