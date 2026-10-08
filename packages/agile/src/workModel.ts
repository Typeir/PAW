/**
 * PAW Agile Work Model
 *
 * @fileoverview What a host loads when this module is installed: the work-model
 * contract PAW declares, implemented over the task graph. A caller hands over a
 * document and receives rendered rows; the graph never leaves this package.
 *
 * @module @paw/agile/workModel
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { buildGraph, graphRows, taskDetail, type TaskDetail, type TaskView } from './application/taskView.js';

/**
 * The module's implementation of the work-model contract.
 *
 * @constant
 */
export const workModel = {
  /**
   * Whole graph from a document.
   *
   * @param {string} document - The task document.
   * @param {string} field - Numeric field to total per task.
   * @returns {TaskView} Rows, refusals, loops, and dangling edges.
   */
  view(document: string, field: string): TaskView {
    const built = buildGraph(document);
    return {
      rows: graphRows(built.graph, field),
      refusals: built.refusals,
      loops: built.graph.loops,
      dangling: built.graph.dangling,
    };
  },

  /**
   * One task with everything connected to it.
   *
   * @param {string} document - The task document.
   * @param {string} id - Task to describe.
   * @param {string} field - Numeric field to total per task.
   * @returns {TaskDetail | null} The task, or null when the document has no such task.
   */
  detail(document: string, id: string, field: string): TaskDetail | null {
    return taskDetail(buildGraph(document).graph, id, field);
  },
};
