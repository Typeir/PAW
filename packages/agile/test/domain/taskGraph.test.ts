/**
 * Task Graph Tests
 *
 * @fileoverview Cover the graph on a convergent shape — a → b, a → c, b → d,
 * c → d, c → e, d → f, e → f — plus the refusals: blank and duplicate ids,
 * unknown endpoints, self-links, and edges that close a loop. Traversal,
 * ordering, and rollup are asserted where d and f have two parents each.
 *
 * @module @paw/agile/test/domain/taskGraph
 */

import { describe, expect, it } from 'vitest';
import {
  addTask,
  ancestorsOf,
  childrenOf,
  descendantsOf,
  emptyGraph,
  ingestLink,
  link,
  parentsOf,
  rollup,
  rootsOf,
  topologicalOrder,
  unlink,
  type Task,
  type TaskGraph,
} from '../../src/domain/taskGraph.js';

/**
 * Add a task, failing the test when the graph refuses.
 *
 * @param {TaskGraph} graph - The graph.
 * @param {string} id - Task id, used as the title too.
 * @param {number} [points] - Value for the `points` field.
 * @returns {TaskGraph} Next graph.
 */
function withTask(graph: TaskGraph, id: string, points?: number): TaskGraph {
  const task: Task = { id, title: id.toUpperCase(), fields: { points } };
  const edit = addTask(graph, task);
  if (!edit.ok) {
    throw new Error(edit.reason);
  }
  return edit.graph;
}

/**
 * Link a parent to a child, failing the test when the graph refuses.
 *
 * @param {TaskGraph} graph - The graph.
 * @param {string} parentId - The parent.
 * @param {string} childId - The child.
 * @returns {TaskGraph} Next graph.
 */
function withLink(graph: TaskGraph, parentId: string, childId: string): TaskGraph {
  const edit = link(graph, parentId, childId);
  if (!edit.ok) {
    throw new Error(edit.reason);
  }
  return edit.graph;
}

/**
 * The convergent shape, every task carrying one point.
 *
 * @returns {TaskGraph} The graph.
 */
function convergent(): TaskGraph {
  let graph = emptyGraph();
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
    graph = withTask(graph, id, 1);
  }
  const edges: ReadonlyArray<readonly [string, string]> = [
    ['a', 'b'],
    ['a', 'c'],
    ['b', 'd'],
    ['c', 'd'],
    ['c', 'e'],
    ['d', 'f'],
    ['e', 'f'],
  ];
  for (const [parent, child] of edges) {
    graph = withLink(graph, parent, child);
  }
  return graph;
}

describe('addTask', () => {
  it('adds a task and refuses a blank id or a duplicate', () => {
    const graph = withTask(emptyGraph(), 'a');
    expect(graph.tasks.get('a')?.title).toBe('A');

    const blank = addTask(graph, { id: '  ', title: 'x', fields: {} });
    expect(blank).toEqual({ ok: false, reason: 'a task id is required' });

    const dupe = addTask(graph, { id: 'a', title: 'other', fields: {} });
    expect(dupe.ok).toBe(false);
    expect(dupe.ok === false && dupe.reason).toContain('already in the graph');
  });
});

describe('link', () => {
  it('gives a task many parents and many children', () => {
    const graph = convergent();
    expect(childrenOf(graph, 'a')).toEqual(['b', 'c']);
    expect(parentsOf(graph, 'd')).toEqual(['b', 'c']);
    expect(parentsOf(graph, 'f')).toEqual(['d', 'e']);
    expect(parentsOf(graph, 'e')).toEqual(['c']);
    expect(childrenOf(graph, 'f')).toEqual([]);
    expect(parentsOf(graph, 'a')).toEqual([]);
  });

  it('refuses an unknown parent, an unknown child, and a self-link', () => {
    const graph = withTask(withTask(emptyGraph(), 'a'), 'b');
    expect(link(graph, 'zz', 'a')).toEqual({ ok: false, reason: 'unknown task "zz"' });
    expect(link(graph, 'a', 'zz')).toEqual({ ok: false, reason: 'unknown task "zz"' });
    expect(link(graph, 'a', 'a')).toEqual({
      ok: false,
      reason: 'cannot link "a" to itself',
    });
  });

  it('is idempotent — re-linking an existing edge changes nothing', () => {
    const graph = convergent();
    const again = link(graph, 'a', 'b');
    expect(again.ok).toBe(true);
    expect(again.ok === true && again.graph).toBe(graph);
  });

  it('refuses an edge that closes a loop, naming the path that already runs', () => {
    const graph = convergent();
    const back = link(graph, 'f', 'a');
    expect(back.ok).toBe(false);
    expect(back.ok === false && back.reason).toBe(
      'cannot link "f" to "a": that closes a loop, "a" already reaches "f" via a → b → d → f',
    );
  });

  it('refuses a one-hop loop and leaves the graph untouched', () => {
    const graph = convergent();
    const back = link(graph, 'd', 'b');
    expect(back.ok).toBe(false);
    expect(back.ok === false && back.reason).toContain('b → d');
    expect(parentsOf(graph, 'b')).toEqual(['a']);
  });

  it('allows a second edge into a task already reached another way', () => {
    const graph = withLink(convergent(), 'a', 'f');
    expect(parentsOf(graph, 'f')).toEqual(['d', 'e', 'a']);
  });

  it('allows an edge whose loop search walks the whole convergent graph and finds nothing', () => {
    const graph = withLink(withTask(convergent(), 'g', 1), 'g', 'a');
    expect(parentsOf(graph, 'a')).toEqual(['g']);
    expect(rollup(graph, 'g', 'points')).toBe(7);
  });
});

describe('ingestLink', () => {
  const take = ingestLink;

  it('declares a ring-closing edge instead of refusing it, and never walks it', () => {
    const graph = take(convergent(), 'f', 'a');
    expect(graph.loops).toEqual([{ parent: 'f', child: 'a' }]);
    expect(childrenOf(graph, 'f')).toEqual([]);
    expect(parentsOf(graph, 'a')).toEqual([]);
    expect(descendantsOf(graph, 'a')).toEqual(['b', 'c', 'd', 'e', 'f']);
    expect(rollup(graph, 'a', 'points')).toBe(6);
  });

  it('declares a self-link as a ring of one', () => {
    const graph = take(convergent(), 'a', 'a');
    expect(graph.loops).toEqual([{ parent: 'a', child: 'a' }]);
    expect(childrenOf(graph, 'a')).toEqual(['b', 'c']);
  });

  it('takes an ordinary edge as a walkable one', () => {
    const graph = take(withTask(convergent(), 'g', 1), 'g', 'a');
    expect(graph.loops).toEqual([]);
    expect(parentsOf(graph, 'a')).toEqual(['g']);
  });

  it('is idempotent', () => {
    const graph = convergent();
    expect(ingestLink(graph, 'a', 'b')).toBe(graph);
  });

  it('records an edge naming an absent task rather than dropping it, either end', () => {
    const missingParent = take(convergent(), 'ghost', 'a');
    expect(missingParent.dangling).toEqual([{ parent: 'ghost', child: 'a' }]);
    expect(parentsOf(missingParent, 'a')).toEqual([]);

    const missingChild = take(convergent(), 'a', 'ghost');
    expect(missingChild.dangling).toEqual([{ parent: 'a', child: 'ghost' }]);
    expect(childrenOf(missingChild, 'a')).toEqual(['b', 'c']);
    expect(descendantsOf(missingChild, 'a')).toEqual(['b', 'c', 'd', 'e', 'f']);
  });
});

describe('unlink', () => {
  it('drops one edge and leaves the other parent, and no-ops on an absent edge', () => {
    const graph = unlink(convergent(), 'b', 'd');
    expect(parentsOf(graph, 'd')).toEqual(['c']);
    expect(childrenOf(graph, 'b')).toEqual([]);

    const absent = unlink(graph, 'b', 'd');
    expect(parentsOf(absent, 'd')).toEqual(['c']);
    expect(unlink(emptyGraph(), 'x', 'y').tasks.size).toBe(0);
  });
});

describe('descendantsOf / ancestorsOf', () => {
  it('reports each converged task once', () => {
    const graph = convergent();
    expect(descendantsOf(graph, 'a')).toEqual(['b', 'c', 'd', 'e', 'f']);
    expect(ancestorsOf(graph, 'f')).toEqual(['d', 'e', 'b', 'c', 'a']);
    expect(descendantsOf(graph, 'f')).toEqual([]);
    expect(ancestorsOf(graph, 'a')).toEqual([]);
  });

  it('reports nothing for a task the graph does not hold', () => {
    expect(descendantsOf(convergent(), 'zz')).toEqual([]);
  });
});

describe('rootsOf / topologicalOrder', () => {
  it('finds the parentless tasks', () => {
    const graph = withTask(convergent(), 'lone');
    expect(rootsOf(graph)).toEqual(['a', 'lone']);
  });

  it('orders every task after all of its parents', () => {
    const order = topologicalOrder(convergent());
    expect(order).toHaveLength(6);
    for (const [parent, child] of [
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'd'],
      ['c', 'd'],
      ['c', 'e'],
      ['d', 'f'],
      ['e', 'f'],
    ]) {
      expect(order.indexOf(parent)).toBeLessThan(order.indexOf(child));
    }
  });
});

describe('rollup', () => {
  it('counts a converged task once, not once per parent', () => {
    const graph = convergent();
    expect(rollup(graph, 'a', 'points')).toBe(6);
    expect(rollup(graph, 'c', 'points')).toBe(4);
    expect(rollup(graph, 'f', 'points')).toBe(1);
  });

  it('ignores absent and non-numeric values, and an unknown task', () => {
    let graph = withTask(emptyGraph(), 'root', 2);
    graph = withTask(graph, 'blank');
    const text = addTask(graph, { id: 'text', title: 'T', fields: { points: 'two' } });
    graph = text.ok ? text.graph : graph;
    graph = withLink(withLink(graph, 'root', 'blank'), 'root', 'text');
    expect(rollup(graph, 'root', 'points')).toBe(2);
    expect(rollup(graph, 'root', 'unknownField')).toBe(0);
    expect(rollup(graph, 'zz', 'points')).toBe(0);
  });
});
