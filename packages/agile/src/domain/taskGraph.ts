/**
 * PAW Agile Task Graph
 *
 * @fileoverview A multi-parent directed acyclic graph of tasks. Every edit is
 * pure and returns a new graph or a refusal. A direct write through `link`
 * refuses an edge that closes a loop and names the path; `ingestLink` declares
 * that edge into `loops` instead, because a backend's data is never dropped. A
 * task carries an opaque field bag; this module names no rung, status, or
 * workflow.
 *
 * @module @paw/agile/domain/taskGraph
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * One task.
 *
 * @interface Task
 * @property {string} id - Stable identity within the graph.
 * @property {string} title - Display text.
 * @property {Readonly<Record<string, unknown>>} fields - Opaque field bag.
 */
export interface Task {
  readonly id: string;
  readonly title: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/**
 * One edge, as recorded rather than walked.
 *
 * @interface Edge
 * @property {string} parent - Task the edge points from.
 * @property {string} child - Task the edge points to.
 */
export interface Edge {
  readonly parent: string;
  readonly child: string;
}

/**
 * Tasks and their edges. Both edge maps hold the same walkable edges, keyed
 * each way. `loops` holds edges that close a ring: recorded, never walked, so
 * every traversal and rollup is total without filtering them out.
 *
 * @interface TaskGraph
 * @property {ReadonlyMap<string, Task>} tasks - Tasks by id, insertion order.
 * @property {ReadonlyMap<string, readonly string[]>} parents - Parent ids by child id.
 * @property {ReadonlyMap<string, readonly string[]>} children - Child ids by parent id.
 * @property {readonly Edge[]} loops - Edges declared as ring-closing.
 * @property {readonly Edge[]} dangling - Edges naming a task the graph does not hold.
 */
export interface TaskGraph {
  readonly tasks: ReadonlyMap<string, Task>;
  readonly parents: ReadonlyMap<string, readonly string[]>;
  readonly children: ReadonlyMap<string, readonly string[]>;
  readonly loops: readonly Edge[];
  readonly dangling: readonly Edge[];
}

/**
 * Outcome of an edit: the next graph, or the reason it was refused.
 */
export type GraphEdit =
  | { readonly ok: true; readonly graph: TaskGraph }
  | { readonly ok: false; readonly reason: string };

/**
 * A graph with no tasks.
 *
 * @returns {TaskGraph} The empty graph.
 */
export function emptyGraph(): TaskGraph {
  return {
    tasks: new Map(),
    parents: new Map(),
    children: new Map(),
    loops: [],
    dangling: [],
  };
}

/**
 * A task's parents, empty when it has none.
 *
 * @param {TaskGraph} graph - The graph.
 * @param {string} id - Task id.
 * @returns {readonly string[]} Parent ids, link order.
 */
export function parentsOf(graph: TaskGraph, id: string): readonly string[] {
  return graph.parents.get(id) ?? [];
}

/**
 * A task's children, empty when it has none.
 *
 * @param {TaskGraph} graph - The graph.
 * @param {string} id - Task id.
 * @returns {readonly string[]} Child ids, link order.
 */
export function childrenOf(graph: TaskGraph, id: string): readonly string[] {
  return graph.children.get(id) ?? [];
}

/**
 * Add a task. A blank id and an id already in the graph are refused.
 *
 * @param {TaskGraph} graph - The graph.
 * @param {Task} task - The task to add.
 * @returns {GraphEdit} Next graph, or refusal.
 */
export function addTask(graph: TaskGraph, task: Task): GraphEdit {
  if (task.id.trim() === '') {
    return { ok: false, reason: 'a task id is required' };
  }
  if (graph.tasks.has(task.id)) {
    return { ok: false, reason: `task "${task.id}" is already in the graph` };
  }
  const tasks = new Map(graph.tasks);
  tasks.set(task.id, task);
  return { ok: true, graph: { ...graph, tasks } };
}

/**
 * The downward path from one task to another, or null when it does not reach.
 *
 * @param {TaskGraph} graph - The graph.
 * @param {string} from - Task to walk down from.
 * @param {string} to - Task to reach.
 * @param {Set<string>} seen - Tasks already walked.
 * @returns {string[] | null} The path, `from` first and `to` last, or null.
 */
function pathDown(
  graph: TaskGraph,
  from: string,
  to: string,
  seen: Set<string>,
): string[] | null {
  if (from === to) {
    return [from];
  }
  seen.add(from);
  for (const child of childrenOf(graph, from)) {
    if (!seen.has(child)) {
      const tail = pathDown(graph, child, to, seen);
      if (tail !== null) {
        return [from, ...tail];
      }
    }
  }
  return null;
}

/**
 * Add an edge to a map of adjacency lists.
 *
 * @param {ReadonlyMap<string, readonly string[]>} edges - Current lists.
 * @param {string} key - List to append to.
 * @param {string} value - Id to append.
 * @returns {Map<string, readonly string[]>} New lists.
 */
function withEdge(
  edges: ReadonlyMap<string, readonly string[]>,
  key: string,
  value: string,
): Map<string, readonly string[]> {
  const next = new Map(edges);
  next.set(key, [...(edges.get(key) ?? []), value]);
  return next;
}

/**
 * Drop an edge from a map of adjacency lists.
 *
 * @param {ReadonlyMap<string, readonly string[]>} edges - Current lists.
 * @param {string} key - List to filter.
 * @param {string} value - Id to drop.
 * @returns {Map<string, readonly string[]>} New lists.
 */
function withoutEdge(
  edges: ReadonlyMap<string, readonly string[]>,
  key: string,
  value: string,
): Map<string, readonly string[]> {
  const next = new Map(edges);
  next.set(
    key,
    (edges.get(key) ?? []).filter((id) => id !== value),
  );
  return next;
}

/**
 * Make one task the parent of another. Unknown endpoints, a self-link, and an
 * edge closing a loop are refused; the loop refusal names the path. Re-linking
 * an existing edge is a no-op.
 *
 * @param {TaskGraph} graph - The graph.
 * @param {string} parentId - Task that becomes the parent.
 * @param {string} childId - Task that becomes the child.
 * @returns {GraphEdit} Next graph, or refusal.
 */
export function link(graph: TaskGraph, parentId: string, childId: string): GraphEdit {
  if (!graph.tasks.has(parentId)) {
    return { ok: false, reason: `unknown task "${parentId}"` };
  }
  if (!graph.tasks.has(childId)) {
    return { ok: false, reason: `unknown task "${childId}"` };
  }
  if (parentId === childId) {
    return { ok: false, reason: `cannot link "${parentId}" to itself` };
  }
  if (childrenOf(graph, parentId).includes(childId)) {
    return { ok: true, graph };
  }
  const loop = pathDown(graph, childId, parentId, new Set());
  if (loop !== null) {
    return {
      ok: false,
      reason: `cannot link "${parentId}" to "${childId}": that closes a loop, "${childId}" already reaches "${parentId}" via ${loop.join(' → ')}`,
    };
  }
  return {
    ok: true,
    graph: {
      ...graph,
      parents: withEdge(graph.parents, childId, parentId),
      children: withEdge(graph.children, parentId, childId),
    },
  };
}

/**
 * Take an edge from a backend. Nothing is refused: an edge that closes a ring —
 * a self-link included — is declared into `loops`, and an edge naming a task
 * the graph does not hold is declared into `dangling`. Both are recorded and
 * neither is walked, so no traversal can recurse or reach a task that is not
 * there. Re-taking an existing edge is a no-op.
 *
 * @param {TaskGraph} graph - The graph.
 * @param {string} parentId - Task the edge points from.
 * @param {string} childId - Task the edge points to.
 * @returns {TaskGraph} Next graph. Ingest never refuses, so there is nothing to report.
 */
export function ingestLink(graph: TaskGraph, parentId: string, childId: string): TaskGraph {
  if (!graph.tasks.has(parentId) || !graph.tasks.has(childId)) {
    return { ...graph, dangling: [...graph.dangling, { parent: parentId, child: childId }] };
  }
  if (childrenOf(graph, parentId).includes(childId)) {
    return graph;
  }
  if (parentId === childId || pathDown(graph, childId, parentId, new Set()) !== null) {
    return { ...graph, loops: [...graph.loops, { parent: parentId, child: childId }] };
  }
  return {
    ...graph,
    parents: withEdge(graph.parents, childId, parentId),
    children: withEdge(graph.children, parentId, childId),
  };
}

/**
 * Drop an edge. Dropping one that is not there is a no-op.
 *
 * @param {TaskGraph} graph - The graph.
 * @param {string} parentId - The parent.
 * @param {string} childId - The child.
 * @returns {TaskGraph} Next graph.
 */
export function unlink(graph: TaskGraph, parentId: string, childId: string): TaskGraph {
  return {
    ...graph,
    parents: withoutEdge(graph.parents, childId, parentId),
    children: withoutEdge(graph.children, parentId, childId),
  };
}

/**
 * Every task reachable by repeating one step, each reported once.
 *
 * @param {string} start - Task to walk from; not itself reported.
 * @param {(id: string) => readonly string[]} step - One hop.
 * @returns {string[]} Reached ids, breadth first.
 */
function reachable(start: string, step: (id: string) => readonly string[]): string[] {
  const seen = new Set<string>();
  const queue: string[] = [...step(start)];
  const reached: string[] = [];
  let head = 0;
  while (head < queue.length) {
    const id = queue[head];
    head += 1;
    if (!seen.has(id)) {
      seen.add(id);
      reached.push(id);
      queue.push(...step(id));
    }
  }
  return reached;
}

/**
 * Every task below one, deduplicated.
 *
 * @param {TaskGraph} graph - The graph.
 * @param {string} id - Task to walk down from.
 * @returns {string[]} Descendant ids, breadth first.
 */
export function descendantsOf(graph: TaskGraph, id: string): string[] {
  return reachable(id, (node) => childrenOf(graph, node));
}

/**
 * Every task above one, deduplicated.
 *
 * @param {TaskGraph} graph - The graph.
 * @param {string} id - Task to walk up from.
 * @returns {string[]} Ancestor ids, breadth first.
 */
export function ancestorsOf(graph: TaskGraph, id: string): string[] {
  return reachable(id, (node) => parentsOf(graph, node));
}

/**
 * Tasks with no parent.
 *
 * @param {TaskGraph} graph - The graph.
 * @returns {string[]} Root ids, insertion order.
 */
export function rootsOf(graph: TaskGraph): string[] {
  return [...graph.tasks.keys()].filter((id) => parentsOf(graph, id).length === 0);
}

/**
 * Every task, each after all of its parents.
 *
 * @param {TaskGraph} graph - The graph.
 * @returns {string[]} Task ids, parents first.
 */
export function topologicalOrder(graph: TaskGraph): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const visit = (id: string): void => {
    if (!seen.has(id)) {
      seen.add(id);
      for (const parent of parentsOf(graph, id)) {
        visit(parent);
      }
      ordered.push(id);
    }
  };
  for (const id of graph.tasks.keys()) {
    visit(id);
  }
  return ordered;
}

/**
 * Sum a numeric field over a task and everything below it, each task counted
 * once. Absent and non-numeric values add nothing.
 *
 * @param {TaskGraph} graph - The graph.
 * @param {string} id - Task to total from.
 * @param {string} field - Field to read on each task.
 * @returns {number} The total.
 */
export function rollup(graph: TaskGraph, id: string, field: string): number {
  let total = 0;
  for (const node of [id, ...descendantsOf(graph, id)]) {
    const value = graph.tasks.get(node)?.fields[field];
    if (typeof value === 'number') {
      total += value;
    }
  }
  return total;
}
