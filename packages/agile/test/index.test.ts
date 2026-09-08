/**
 * Public API Tests
 *
 * @fileoverview Pins what the module exports. A consumer resolves `@paw/agile`
 * to this surface and nothing else.
 *
 * @module @paw/agile/test/index
 */

import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

describe('@paw/agile', () => {
  it('exports the graph verbs and nothing else', () => {
    expect(Object.keys(api).sort()).toEqual([
      'addTask',
      'ancestorsOf',
      'buildGraph',
      'childrenOf',
      'descendantsOf',
      'emptyGraph',
      'graphRows',
      'ingestLink',
      'link',
      'parentsOf',
      'rollup',
      'rootsOf',
      'taskDetail',
      'taskViewFrom',
      'topologicalOrder',
      'unlink',
    ]);
  });

  it('builds a two-parent graph through the public surface', () => {
    let graph = api.emptyGraph();
    for (const id of ['a', 'b', 'c']) {
      const added = api.addTask(graph, { id, title: id, fields: { points: 2 } });
      graph = added.ok ? added.graph : graph;
    }
    const first = api.link(graph, 'a', 'c');
    graph = first.ok ? first.graph : graph;
    const second = api.link(graph, 'b', 'c');
    graph = second.ok ? second.graph : graph;

    expect(api.parentsOf(graph, 'c')).toEqual(['a', 'b']);
    expect(api.rollup(graph, 'a', 'points')).toBe(4);
  });
});
