/**
 * Node Work Model Source
 *
 * @fileoverview Opens the work-model module a repository installed and reads
 * its task document. The module is loaded from where the resolver found it, so
 * this package holds no dependency on any module. Three states a caller must
 * tell apart: the module is not enabled, it is enabled but not installed, or it
 * is ready. Read per call, so an edit shows on the next read.
 *
 * @module @paw/adapters/config/nodeTaskSource
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { join } from 'node:path';
import {
  SYNC_LOG_FILE,
  emptyWorkGraph,
  enabledModuleIds,
  repoTaskView,
  VENDOR_MODULES,
  type ModuleEntry,
  type RepoTaskView,
  type WorkModelPort,
} from '@paw/core';
import { importModuleEntry } from './moduleEntry.js';
import { createNodeModuleResolver } from './nodeModuleResolver.js';
import { createNodeConfigDocument } from './nodeConfigDocument.js';
import { readOptionalText } from './optionalText.js';

/**
 * Module that must be enabled for a repository to hold tasks.
 */
export const AGILE_MODULE = 'paw-agile';

/**
 * Field the rollup totals on every task.
 */
export const ROLLUP_FIELD = 'points';

/**
 * A repository's work model, as far as it got.
 *
 * @interface RepoWorkModel
 * @property {boolean} enabled - Whether `.paw/config.json` enables the module.
 * @property {boolean} installed - Whether the module was found and loaded.
 * @property {WorkModelPort | null} model - The loaded model, or null.
 * @property {string} document - The task document; empty when there is none.
 * @property {string} detail - Entry the model loaded from, or why it did not load.
 */
export interface RepoWorkModel {
  readonly enabled: boolean;
  readonly installed: boolean;
  readonly model: WorkModelPort | null;
  readonly document: string;
  readonly detail: string;
}

const ABSENT: RepoWorkModel = {
  enabled: false,
  installed: false,
  model: null,
  document: '',
  detail: `${AGILE_MODULE} is not enabled in .paw/config.json`,
};

/**
 * Load the work model a resolved module exports.
 *
 * @param {string} manifest - Path to the module's `package.json`.
 * @returns {Promise<{ model: WorkModelPort | null; detail: string }>} The model and its entry, or null and why it did not load.
 */
async function loadModel(
  manifest: string,
): Promise<{ model: WorkModelPort | null; detail: string }> {
  const loaded = await importModuleEntry(manifest);
  if (!loaded.ok) {
    return { model: null, detail: loaded.detail };
  }
  const model = loaded.exports.workModel as WorkModelPort | undefined;
  return model === undefined
    ? { model: null, detail: `${loaded.entry} exports no workModel` }
    : { model, detail: loaded.entry };
}

/**
 * Open the work model for a repository.
 *
 * @param {string} root - Repository to read from.
 * @returns {Promise<RepoWorkModel>} Module state, the model, and the document.
 */
export async function openRepoWorkModel(root: string): Promise<RepoWorkModel> {
  const config = await createNodeConfigDocument(root).read();
  if (!enabledModuleIds(config).includes(AGILE_MODULE)) {
    return ABSENT;
  }
  const entry = VENDOR_MODULES.find((candidate) => candidate.id === AGILE_MODULE) as ModuleEntry;
  const found = await createNodeModuleResolver(root).resolve(entry);
  if (!found.resolved) {
    return { enabled: true, installed: false, model: null, document: '', detail: found.detail };
  }
  const loaded = await loadModel(found.detail);
  if (loaded.model === null) {
    return { enabled: true, installed: false, model: null, document: '', detail: loaded.detail };
  }
  return {
    enabled: true,
    installed: true,
    model: loaded.model,
    document: await readOptionalText(join(root, '.paw', 'tasks.json')),
    detail: loaded.detail,
  };
}

/**
 * Read a repository's tasks as every surface shows them: the work graph as list rows and each
 * enabled backend's freshness from the sync log.
 *
 * @param {string} root - Repository to read from.
 * @returns {Promise<RepoTaskView>} The view; no rows when the module is off or not installed.
 * @throws {Error} Any read failure other than a missing file.
 */
export async function readRepoTasks(root: string): Promise<RepoTaskView> {
  const opened = await openRepoWorkModel(root);
  return repoTaskView({
    enabled: opened.enabled && opened.installed,
    view: opened.model?.view(opened.document, ROLLUP_FIELD) ?? emptyWorkGraph(),
    config: await createNodeConfigDocument(root).read(),
    syncLog: await readOptionalText(join(root, SYNC_LOG_FILE)),
  });
}
