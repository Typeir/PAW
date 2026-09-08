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
  link,
  parentsOf,
  rollup,
  rootsOf,
  topologicalOrder,
  unlink,
} from './domain/taskGraph.js';
export type { GraphEdit, Task, TaskGraph } from './domain/taskGraph.js';
