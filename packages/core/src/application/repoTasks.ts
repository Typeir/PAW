/**
 * PAW Repository Task View
 *
 * @fileoverview What every surface shows for a repository's tasks: the work graph as list rows
 * and each enabled backend's freshness. Pure; a shell reads the document, config, and sync log.
 *
 * @module @paw/core/application/repoTasks
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { backendFreshness, parseSyncLog, type BackendFreshness } from '../domain/backendSync.js';
import type { ConfigDocument } from '../domain/config.js';
import { listRow, type TaskListRow, type WorkEdge, type WorkGraphView } from '../domain/workModel.js';

/**
 * Inputs a shell gathers.
 *
 * @interface RepoTaskInput
 * @property {boolean} enabled - Whether the work-model module is enabled and loaded.
 * @property {WorkGraphView} view - The module's view of the task document.
 * @property {ConfigDocument} config - The config document.
 * @property {string} syncLog - Sync log text; blank when absent.
 */
export interface RepoTaskInput {
  readonly enabled: boolean;
  readonly view: WorkGraphView;
  readonly config: ConfigDocument;
  readonly syncLog: string;
}

/**
 * A repository's tasks as a surface renders them.
 *
 * @interface RepoTaskView
 * @property {boolean} enabled - Whether the work-model module is enabled and loaded.
 * @property {readonly TaskListRow[]} rows - Rows, parents before children.
 * @property {readonly string[]} refusals - Document refusals, then a sync log refusal.
 * @property {readonly WorkEdge[]} loops - Ring-closing edges, recorded and not walked.
 * @property {readonly WorkEdge[]} dangling - Edges naming an absent task.
 * @property {readonly BackendFreshness[]} backends - Each enabled backend and its last sync.
 */
export interface RepoTaskView {
  readonly enabled: boolean;
  readonly rows: readonly TaskListRow[];
  readonly refusals: readonly string[];
  readonly loops: readonly WorkEdge[];
  readonly dangling: readonly WorkEdge[];
  readonly backends: readonly BackendFreshness[];
}

/**
 * Compose a repository's task view.
 *
 * @param {RepoTaskInput} input - Module state, view, config, and sync log.
 * @returns {RepoTaskView} The view.
 */
export function repoTaskView(input: RepoTaskInput): RepoTaskView {
  const log = parseSyncLog(input.syncLog);
  return {
    enabled: input.enabled,
    rows: input.view.rows.map(listRow),
    refusals: log.ok ? input.view.refusals : [...input.view.refusals, log.reason],
    loops: input.view.loops,
    dangling: input.view.dangling,
    backends: backendFreshness(input.config, log.ok ? log.last : {}),
  };
}
