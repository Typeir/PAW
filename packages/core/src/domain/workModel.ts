/**
 * PAW Work Model Contract
 *
 * @fileoverview The shape a work-model module renders for every surface. PAW
 * declares this; a module implements it. The module's own graph type never
 * crosses the boundary — a caller hands over a document and receives rows.
 *
 * @module @paw/core/domain/workModel
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * One edge recorded but never walked.
 *
 * @interface WorkEdge
 * @property {string} parent - Task the edge points from.
 * @property {string} child - Task the edge points to.
 */
export interface WorkEdge {
  readonly parent: string;
  readonly child: string;
}

/**
 * One task as a surface renders it.
 *
 * @interface WorkTaskRow
 * @property {string} id - Task id.
 * @property {string} title - Display text.
 * @property {readonly string[]} parents - Parent ids.
 * @property {readonly string[]} children - Child ids.
 * @property {number} depth - Longest distance from a root, for indenting.
 * @property {number} rollup - Summed field over this task and everything below it.
 * @property {boolean} orphan - Whether a parent the document names for it is absent.
 * @property {Readonly<Record<string, unknown>>} fields - The task's field bag as the document holds it.
 */
export interface WorkTaskRow {
  readonly id: string;
  readonly title: string;
  readonly parents: readonly string[];
  readonly children: readonly string[];
  readonly depth: number;
  readonly rollup: number;
  readonly orphan: boolean;
  readonly fields: Readonly<Record<string, unknown>>;
}

/**
 * One task as a list renders it: the row without its field bag, plus the tracker link.
 *
 * @interface TaskListRow
 * @property {string | null} link - The task's page in its tracker, `http(s)` only; null when it has none.
 */
export interface TaskListRow extends Omit<WorkTaskRow, 'fields'> {
  readonly link: string | null;
}

/**
 * A list row from a work-model row. The link is the `url` field when it is an `http:` or `https:`
 * URL; a row from a module that predates `fields` gets none.
 *
 * @param {WorkTaskRow} row - Work-model row.
 * @returns {TaskListRow} The list row.
 */
export function listRow(row: WorkTaskRow): TaskListRow {
  const { fields, ...rest } = row;
  const url = (fields as Readonly<Record<string, unknown>> | undefined)?.url;
  return { ...rest, link: typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null };
}

/**
 * A whole work graph, with everything the document asked for and did not get.
 *
 * @interface WorkGraphView
 * @property {readonly WorkTaskRow[]} rows - Rows, parents before children.
 * @property {readonly string[]} refusals - Reasons the parser gave.
 * @property {readonly WorkEdge[]} loops - Ring-closing edges, recorded and not walked.
 * @property {readonly WorkEdge[]} dangling - Edges naming an absent task.
 */
export interface WorkGraphView {
  readonly rows: readonly WorkTaskRow[];
  readonly refusals: readonly string[];
  readonly loops: readonly WorkEdge[];
  readonly dangling: readonly WorkEdge[];
}

/**
 * One task with everything connected to it.
 *
 * @interface WorkTaskDetail
 * @property {WorkTaskRow} row - The task itself.
 * @property {readonly WorkTaskRow[]} ancestors - Every task above it, nearest first.
 * @property {readonly WorkTaskRow[]} descendants - Every task below it, nearest first.
 * @property {readonly WorkEdge[]} loops - Ring-closing edges touching it.
 * @property {readonly WorkEdge[]} dangling - Edges touching it that name an absent task.
 */
export interface WorkTaskDetail {
  readonly row: WorkTaskRow;
  readonly ancestors: readonly WorkTaskRow[];
  readonly descendants: readonly WorkTaskRow[];
  readonly loops: readonly WorkEdge[];
  readonly dangling: readonly WorkEdge[];
}

/**
 * The empty view, for a repository with no module or no document.
 *
 * @returns {WorkGraphView} A view with no rows and nothing recorded.
 */
export function emptyWorkGraph(): WorkGraphView {
  return { rows: [], refusals: [], loops: [], dangling: [] };
}
