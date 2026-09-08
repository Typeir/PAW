/**
 * Node Task Source
 *
 * @fileoverview Reads a repository's `.paw/tasks.json` through the work-model
 * kernel. The `paw-agile` module must be enabled in `.paw/config.json`; when it
 * is not, the source reports `enabled: false` and reads nothing. A repository
 * with no task document reports an empty graph. Read per call, so an edit shows
 * on the next read.
 *
 * @module @paw/adapters/config/nodeTaskSource
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildGraph, emptyGraph, type TaskGraph } from '@paw/agile';
import { enabledModuleIds } from '@paw/core';
import { createNodeConfigDocument } from './nodeConfigDocument.js';

/**
 * Module that must be enabled for a repository to hold tasks.
 */
export const AGILE_MODULE = 'paw-agile';

/**
 * Field the rollup totals on every task.
 */
export const ROLLUP_FIELD = 'points';

/**
 * A repository's task graph and whether the module serving it is enabled.
 *
 * @interface RepoTasks
 * @property {boolean} enabled - Whether `.paw/config.json` enables the module.
 * @property {TaskGraph} graph - The graph; empty when the module is off.
 * @property {readonly string[]} refusals - Reasons the kernel or the parser gave.
 */
export interface RepoTasks {
  readonly enabled: boolean;
  readonly graph: TaskGraph;
  readonly refusals: readonly string[];
}

/**
 * The task graph a repository describes.
 *
 * @param {string} root - Repository to read from.
 * @returns {Promise<RepoTasks>} Module state, graph, and refusals.
 */
export async function readRepoTasks(root: string): Promise<RepoTasks> {
  const config = await createNodeConfigDocument(root).read();
  if (!enabledModuleIds(config).includes(AGILE_MODULE)) {
    return { enabled: false, graph: emptyGraph(), refusals: [] };
  }
  try {
    const text = await readFile(join(root, '.paw', 'tasks.json'), 'utf8');
    return { enabled: true, ...buildGraph(text) };
  } catch {
    return { enabled: true, graph: emptyGraph(), refusals: [] };
  }
}
