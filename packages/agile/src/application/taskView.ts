/**
 * PAW Agile Task View
 *
 * @fileoverview Reads a task document and renders the graph as ordered rows.
 * Edges are sorted by parent then child before ingest, so the same document
 * always declares the same ring-closing edge whatever order it arrived in. Only
 * the parser refuses — a malformed entry or edge — and the rest of the document
 * still loads; every edge the kernel cannot walk is recorded instead.
 *
 * @module @paw/agile/application/taskView
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  addTask,
  ancestorsOf,
  childrenOf,
  descendantsOf,
  emptyGraph,
  ingestLink,
  parentsOf,
  rollup,
  topologicalOrder,
  type Edge,
  type TaskGraph,
} from '../domain/taskGraph.js';

/**
 * One task as the console renders it.
 *
 * @interface TaskRow
 * @property {string} id - Task id.
 * @property {string} title - Display text; the id when the document names none.
 * @property {readonly string[]} parents - Parent ids.
 * @property {readonly string[]} children - Child ids.
 * @property {number} depth - Longest distance from a root, for indenting.
 * @property {number} rollup - Summed field over this task and everything below it.
 * @property {boolean} orphan - Whether a parent the document names for it is absent.
 */
export interface TaskRow {
  readonly id: string;
  readonly title: string;
  readonly parents: readonly string[];
  readonly children: readonly string[];
  readonly depth: number;
  readonly rollup: number;
  readonly orphan: boolean;
}

/**
 * The graph as rows, plus everything the document asked for and did not get.
 *
 * @interface TaskView
 * @property {readonly TaskRow[]} rows - Rows, parents before children.
 * @property {readonly string[]} refusals - Reasons the kernel or the parser gave.
 * @property {readonly Edge[]} loops - Edges declared as ring-closing, recorded and not walked.
 * @property {readonly Edge[]} dangling - Edges naming an absent task, recorded and not walked.
 */
export interface TaskView {
  readonly rows: readonly TaskRow[];
  readonly refusals: readonly string[];
  readonly loops: readonly Edge[];
  readonly dangling: readonly Edge[];
}

/**
 * Value as a plain object, empty when it is not one.
 *
 * @param {unknown} value - Candidate.
 * @returns {Record<string, unknown>} The object, or an empty one.
 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Value as an array, empty when it is not one.
 *
 * @param {unknown} value - Candidate.
 * @returns {unknown[]} The array, or an empty one.
 */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Value as a string, or null.
 *
 * @param {unknown} value - Candidate.
 * @returns {string | null} The string, else null.
 */
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Every task as a row, parents before children.
 *
 * @param {TaskGraph} graph - The graph.
 * @param {string} field - Numeric field to total per task.
 * @returns {TaskRow[]} Rows in topological order.
 */
export function graphRows(graph: TaskGraph, field: string): TaskRow[] {
  const titles: Record<string, string> = {};
  for (const [id, task] of graph.tasks) {
    titles[id] = task.title;
  }
  const depths: Record<string, number> = {};
  const depthOf = (id: string): number => {
    if (depths[id] === undefined) {
      const parents = parentsOf(graph, id);
      depths[id] = parents.length === 0 ? 0 : Math.max(...parents.map(depthOf)) + 1;
    }
    return depths[id];
  };
  const orphans = new Set(graph.dangling.map((edge) => edge.child));
  return topologicalOrder(graph).map((id) => ({
    id,
    title: titles[id],
    parents: parentsOf(graph, id),
    children: childrenOf(graph, id),
    depth: depthOf(id),
    rollup: rollup(graph, id, field),
    orphan: orphans.has(id),
  }));
}

/**
 * A parsed document as a graph, with everything it asked for and did not get.
 *
 * @interface BuiltGraph
 * @property {TaskGraph} graph - Every task and edge the kernel accepted.
 * @property {readonly string[]} refusals - Reasons the kernel or the parser gave.
 */
export interface BuiltGraph {
  readonly graph: TaskGraph;
  readonly refusals: readonly string[];
}

/**
 * One task with everything connected to it.
 *
 * @interface TaskDetail
 * @property {TaskRow} row - The task itself.
 * @property {readonly TaskRow[]} ancestors - Every task above it, nearest first.
 * @property {readonly TaskRow[]} descendants - Every task below it, nearest first.
 * @property {readonly Edge[]} loops - Ring-closing edges touching it, recorded and not walked.
 * @property {readonly Edge[]} dangling - Edges touching it that name an absent task.
 */
export interface TaskDetail {
  readonly row: TaskRow;
  readonly ancestors: readonly TaskRow[];
  readonly descendants: readonly TaskRow[];
  readonly loops: readonly Edge[];
  readonly dangling: readonly Edge[];
}

/**
 * Build a graph from a task document. Shape:
 * `{ "tasks": [{ "id", "title", "fields" }], "edges": [["parent", "child"]] }`.
 *
 * @param {string} text - The document; blank text is no document, an empty graph with no refusals.
 * @returns {BuiltGraph} The graph and its refusals.
 */
export function buildGraph(text: string): BuiltGraph {
  if (text.trim() === '') {
    return { graph: emptyGraph(), refusals: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      graph: emptyGraph(),
      refusals: [`task document is not valid JSON: ${String(err)}`],
    };
  }

  const document = asRecord(parsed);
  const refusals: string[] = [];
  let graph = emptyGraph();

  for (const entry of asArray(document.tasks)) {
    const record = asRecord(entry);
    const id = asString(record.id);
    if (id === null) {
      refusals.push('a task entry has no string id');
      continue;
    }
    const edit = addTask(graph, {
      id,
      title: asString(record.title) ?? id,
      fields: asRecord(record.fields),
    });
    if (edit.ok) {
      graph = edit.graph;
      continue;
    }
    refusals.push(edit.reason);
  }

  const edges: Array<readonly [string, string]> = [];
  for (const entry of asArray(document.edges)) {
    const pair = asArray(entry);
    const parent = asString(pair[0]);
    const child = asString(pair[1]);
    if (parent === null || child === null) {
      refusals.push('an edge is not a [parent, child] pair of strings');
      continue;
    }
    edges.push([parent, child]);
  }

  edges.sort((left, right) =>
    left[0] === right[0] ? left[1].localeCompare(right[1]) : left[0].localeCompare(right[0]),
  );

  for (const [parent, child] of edges) {
    graph = ingestLink(graph, parent, child);
  }

  return { graph, refusals };
}

/**
 * Build the view from a task document.
 *
 * @param {string} text - The document.
 * @param {string} field - Numeric field to total per task.
 * @returns {TaskView} Rows and refusals.
 */
export function taskViewFrom(text: string, field: string): TaskView {
  const built = buildGraph(text);
  return {
    rows: graphRows(built.graph, field),
    refusals: built.refusals,
    loops: built.graph.loops,
    dangling: built.graph.dangling,
  };
}

/**
 * One task and everything connected to it, or null when the graph has no such
 * task.
 *
 * @param {TaskGraph} graph - The graph.
 * @param {string} id - Task to describe.
 * @param {string} field - Numeric field to total per task.
 * @returns {TaskDetail | null} The task with its ancestors and descendants.
 */
export function taskDetail(graph: TaskGraph, id: string, field: string): TaskDetail | null {
  const byId: Record<string, TaskRow> = {};
  for (const row of graphRows(graph, field)) {
    byId[row.id] = row;
  }
  if (byId[id] === undefined) {
    return null;
  }
  return {
    row: byId[id],
    loops: graph.loops.filter((edge) => edge.parent === id || edge.child === id),
    dangling: graph.dangling.filter((edge) => edge.parent === id || edge.child === id),
    ancestors: ancestorsOf(graph, id).map((node) => byId[node]),
    descendants: descendantsOf(graph, id).map((node) => byId[node]),
  };
}
