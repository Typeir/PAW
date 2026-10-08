/**
 * PAW Agile — public API
 *
 * @fileoverview The work model PAW owns, shipped as a federated module. A
 * backend connector maps onto this graph. Pure library, imports nothing.
 *
 * @module @paw/agile
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

export {
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
} from './domain/taskGraph.js';
export type { Edge, GraphEdit, Task, TaskGraph } from './domain/taskGraph.js';

export { buildGraph, graphRows, taskDetail, taskViewFrom } from './application/taskView.js';
export type { BuiltGraph, TaskDetail, TaskRow, TaskView } from './application/taskView.js';

export { workModel } from './workModel.js';
