/**
 * PAW OpenProject — public API
 *
 * @fileoverview A backend module: syncs an OpenProject project subtree into the paw-agile task
 * document over API v3. A host loads `backend`, reads the three files it names, calls `sync`, and
 * writes the two texts it returns. Pure library; the network is the injected fetch.
 *
 * @module @paw/openproject
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { sync } from './application/sync.js';
import { ENV_FILE } from './domain/backendEnv.js';
import { STATE_FILE } from './domain/syncState.js';
import { TASKS_FILE } from './domain/taskDocument.js';

export { ENV_FILE, parseBackendEnv } from './domain/backendEnv.js';
export type { BackendConfig, BackendEnv } from './domain/backendEnv.js';

export { ID_PREFIX, recordOf, taskId } from './domain/workPackage.js';
export type { RecordParse, WorkRecord } from './domain/workPackage.js';

export { parseTaskDocument, TASKS_FILE, writeRecords } from './domain/taskDocument.js';
export type { DocumentParse, DocumentWrite, TaskDocument, WriteMode } from './domain/taskDocument.js';

export { parseSyncState, serializeSyncState, STATE_FILE } from './domain/syncState.js';
export type { StateParse, SyncState } from './domain/syncState.js';

export { pullWorkPackages } from './application/pull.js';
export type { FetchLike, FetchResponse, Pull } from './application/pull.js';

export { sync } from './application/sync.js';
export type { SyncInput, SyncResult } from './application/sync.js';

/**
 * What a host loads when this module is installed.
 *
 * @constant
 * @property {{ env: string; state: string; tasks: string }} files - Repository-relative paths `sync` reads and writes.
 * @property {typeof sync} sync - One sync over those files' texts.
 */
export const backend = {
  files: { env: ENV_FILE, state: STATE_FILE, tasks: TASKS_FILE },
  sync,
};
