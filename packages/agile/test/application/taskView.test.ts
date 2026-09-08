/**
 * Task View Tests
 *
 * @fileoverview Cover row rendering over the convergent shape (depth, rollup,
 * parents, children) and every way a document is refused: bad JSON, a
 * non-object root, entries without an id, duplicate ids, malformed edges, and
 * an edge that closes a loop.
 *
 * @module @paw/agile/test/application/taskView
 */

import { describe, expect, it } from 'vitest';
import { buildGraph, graphRows, taskDetail, taskViewFrom } from '../../src/application/taskView.js';
import { addTask, emptyGraph, link, type TaskGraph } from '../../src/domain/taskGraph.js';

/** a → b, a → c, b → d, c → d, c → e, d → f, e → f; one point each. */
const CONVERGENT = JSON.stringify({
  tasks: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
    id,
    title: id.toUpperCase(),
    fields: { points: 1 },
  })),
  edges: [
    ['a', 'b'],
    ['a', 'c'],
    ['b', 'd'],
    ['c', 'd'],
    ['c', 'e'],
    ['d', 'f'],
    ['e', 'f'],
  ],
});

describe('taskViewFrom', () => {
  it('renders the convergent graph with depth, rollup, and both parent sets', () => {
    const view = taskViewFrom(CONVERGENT, 'points');
    expect(view.refusals).toEqual([]);
    expect(view.rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);

    const byId = Object.fromEntries(view.rows.map((r) => [r.id, r]));
    expect(byId.a).toMatchObject({ title: 'A', depth: 0, parents: [], rollup: 6 });
    expect(byId.d).toMatchObject({ parents: ['b', 'c'], children: ['f'], depth: 2 });
    expect(byId.f).toMatchObject({ parents: ['d', 'e'], depth: 3, rollup: 1 });
    expect(byId.c).toMatchObject({ children: ['d', 'e'], rollup: 4 });
  });

  it('falls back to the id when an entry names no title, and to no fields', () => {
    const view = taskViewFrom(JSON.stringify({ tasks: [{ id: 'bare' }] }), 'points');
    expect(view.rows[0]).toMatchObject({ id: 'bare', title: 'bare', rollup: 0, depth: 0 });
  });

  it('reports a document that is not JSON', () => {
    const view = taskViewFrom('{ not json', 'points');
    expect(view.rows).toEqual([]);
    expect(view.refusals[0]).toContain('not valid JSON');
  });

  it('reads a non-object root, a missing tasks key, and a non-array as empty', () => {
    for (const text of ['7', 'null', '[1,2]', '{}', '{"tasks":"nope","edges":3}']) {
      const view = taskViewFrom(text, 'points');
      expect(view).toEqual({ rows: [], refusals: [], loops: [], dangling: [] });
    }
  });

  it('refuses an entry with no string id and a duplicate id, keeping the rest', () => {
    const view = taskViewFrom(
      JSON.stringify({
        tasks: [{ id: 'a' }, { id: 7 }, 'not-an-object', { id: 'a' }, { id: 'b' }],
      }),
      'points',
    );
    expect(view.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(view.refusals).toEqual([
      'a task entry has no string id',
      'a task entry has no string id',
      'task "a" is already in the graph',
    ]);
  });

  it('refuses a malformed edge on either side and keeps the good ones', () => {
    const view = taskViewFrom(
      JSON.stringify({
        tasks: [{ id: 'a' }, { id: 'b' }],
        edges: [['a', 'b'], [7, 'b'], ['a', 7], 'nope', []],
      }),
      'points',
    );
    expect(view.rows.find((r) => r.id === 'b')?.parents).toEqual(['a']);
    expect(view.refusals).toHaveLength(4);
    expect(view.refusals[0]).toContain('[parent, child] pair');
  });

  it('declares a ring-closing edge rather than refusing it', () => {
    const view = taskViewFrom(
      JSON.stringify({
        tasks: [{ id: 'a' }, { id: 'b' }],
        edges: [
          ['a', 'b'],
          ['b', 'a'],
        ],
      }),
      'points',
    );
    expect(view.rows).toHaveLength(2);
    expect(view.refusals).toEqual([]);
    expect(view.loops).toEqual([{ parent: 'b', child: 'a' }]);
  });

  it('declares the same edge whatever order the document lists the ring in', () => {
    const ring: ReadonlyArray<readonly [string, string]> = [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a'],
    ];
    const orders = [
      [ring[0], ring[1], ring[2]],
      [ring[2], ring[1], ring[0]],
      [ring[1], ring[2], ring[0]],
    ];
    for (const edges of orders) {
      const view = taskViewFrom(
        JSON.stringify({ tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges }),
        'points',
      );
      expect(view.loops).toEqual([{ parent: 'c', child: 'a' }]);
      expect(view.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    }
  });

  it('keeps the rollup total when a ring is present, counting nothing twice', () => {
    const view = taskViewFrom(
      JSON.stringify({
        tasks: ['a', 'b', 'c'].map((id) => ({ id, fields: { points: 1 } })),
        edges: [
          ['a', 'b'],
          ['b', 'c'],
          ['c', 'a'],
        ],
      }),
      'points',
    );
    expect(view.rows.find((r) => r.id === 'a')?.rollup).toBe(3);
  });

  it('keeps an edge naming an absent task and marks the orphaned end', () => {
    const view = taskViewFrom(
      JSON.stringify({ tasks: [{ id: 'a' }, { id: 'b' }], edges: [['ghost', 'b'], ['a', 'gone']] }),
      'points',
    );
    expect(view.refusals).toEqual([]);
    expect(view.dangling).toEqual([
      { parent: 'a', child: 'gone' },
      { parent: 'ghost', child: 'b' },
    ]);
    expect(view.rows.find((r) => r.id === 'b')?.orphan).toBe(true);
    expect(view.rows.find((r) => r.id === 'a')?.orphan).toBe(false);
  });
});

describe('taskDetail', () => {
  it('returns a task with everything above and below it, deduplicated', () => {
    const { graph } = buildGraph(CONVERGENT);
    const detail = taskDetail(graph, 'd', 'points');
    expect(detail?.row).toMatchObject({ id: 'd', parents: ['b', 'c'], children: ['f'] });
    expect(detail?.ancestors.map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(detail?.descendants.map((r) => r.id)).toEqual(['f']);
  });

  it('carries the rendered row for every related task, not just its id', () => {
    const { graph } = buildGraph(CONVERGENT);
    expect(taskDetail(graph, 'f', 'points')?.ancestors[0]).toMatchObject({
      id: 'd',
      title: 'D',
      rollup: 2,
    });
  });

  it('returns null for a task the graph does not hold', () => {
    expect(taskDetail(buildGraph(CONVERGENT).graph, 'ghost', 'points')).toBeNull();
  });

  it('reports a root with no ancestors and a leaf with no descendants', () => {
    const { graph } = buildGraph(CONVERGENT);
    expect(taskDetail(graph, 'a', 'points')?.ancestors).toEqual([]);
    expect(taskDetail(graph, 'f', 'points')?.descendants).toEqual([]);
  });
});

describe('buildGraph', () => {
  it('hands back the graph the kernel accepted, the ring declared not refused', () => {
    const built = buildGraph(
      JSON.stringify({
        tasks: [{ id: 'a' }, { id: 'b' }],
        edges: [
          ['a', 'b'],
          ['b', 'a'],
        ],
      }),
    );
    expect(built.graph.tasks.size).toBe(2);
    expect(built.graph.loops).toEqual([{ parent: 'b', child: 'a' }]);
    expect(built.refusals).toEqual([]);
  });

  it('records an edge naming an absent task without refusing it', () => {
    const built = buildGraph(JSON.stringify({ tasks: [{ id: 'a' }], edges: [['a', 'ghost']] }));
    expect(built.refusals).toEqual([]);
    expect(built.graph.dangling).toEqual([{ parent: 'a', child: 'ghost' }]);
    expect(built.graph.loops).toEqual([]);
  });

  it('hands back an empty graph for a document that is not JSON', () => {
    const built = buildGraph('{ not json');
    expect(built.graph.tasks.size).toBe(0);
    expect(built.refusals[0]).toContain('not valid JSON');
  });
});

describe('graphRows', () => {
  it('renders an empty graph as no rows', () => {
    expect(graphRows(emptyGraph(), 'points')).toEqual([]);
  });

  it('takes the longest path when a task is reachable at two depths', () => {
    let graph: TaskGraph = emptyGraph();
    for (const id of ['a', 'b', 'c']) {
      const added = addTask(graph, { id, title: id, fields: {} });
      graph = added.ok ? added.graph : graph;
    }
    for (const [p, c] of [
      ['a', 'b'],
      ['b', 'c'],
      ['a', 'c'],
    ]) {
      const edit = link(graph, p, c);
      graph = edit.ok ? edit.graph : graph;
    }
    expect(graphRows(graph, 'points').find((r) => r.id === 'c')?.depth).toBe(2);
  });
});
