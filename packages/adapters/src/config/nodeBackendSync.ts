/**
 * Node Backend Sync
 *
 * @fileoverview Runs every enabled backend connector's sync for a repository: plans through
 * `backendSyncPlan`, loads the module's `backend` from where the resolver found it, reads the
 * files it names (blank when missing), and writes the task document and sidecar it returns.
 * Backends run one after another; a refusal writes nothing. Every round, refusals included, is
 * recorded in `.paw/backend-sync.json`; a log that does not parse stops the round before any pull.
 *
 * @module @paw/adapters/config/nodeBackendSync
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  SYNC_LOG_FILE,
  backendSyncPlan,
  parseSyncLog,
  recordSyncs,
  type BackendFetch,
  type BackendModulePort,
  type BackendSyncReport,
  type BackendSyncStep,
} from '@paw/core';
import { importModuleEntry } from './moduleEntry.js';
import { createNodeConfigDocument } from './nodeConfigDocument.js';
import { createNodeModuleResolver } from './nodeModuleResolver.js';
import { readOptionalText } from './optionalText.js';

/**
 * Whether a module export has the {@link BackendModulePort} shape.
 *
 * @param {unknown} value - The `backend` export.
 * @returns {boolean} True when it carries a `files` object and a `sync` function.
 */
function isBackend(value: unknown): value is BackendModulePort {
  const candidate = value as Partial<BackendModulePort> | undefined;
  return typeof candidate?.sync === 'function' && typeof candidate.files === 'object' && candidate.files !== null;
}

/**
 * Run one planned sync.
 *
 * @param {string} root - Repository root.
 * @param {Extract<BackendSyncStep, { ok: true }>} step - Connector and its sync module.
 * @param {boolean} full - Force a full sweep.
 * @param {BackendFetch} fetch - Fetch handed to the module.
 * @returns {Promise<BackendSyncReport>} Counts, or the refusal.
 */
async function runStep(
  root: string,
  step: Extract<BackendSyncStep, { ok: true }>,
  full: boolean,
  fetch: BackendFetch,
): Promise<BackendSyncReport> {
  const { connector, module } = step;
  const found = await createNodeModuleResolver(root).resolve(module);
  if (!found.resolved) {
    return {
      connector,
      ok: false,
      reason: `module ${module.id} is enabled but not installed (${found.detail}); install it with paw modules install ${module.id}`,
    };
  }
  const loaded = await importModuleEntry(found.detail);
  if (!loaded.ok) {
    return { connector, ok: false, reason: loaded.detail };
  }
  const backend = loaded.exports.backend;
  if (!isBackend(backend)) {
    return { connector, ok: false, reason: `${loaded.entry} exports no backend` };
  }
  const result = await backend.sync({
    env: await readOptionalText(join(root, backend.files.env)),
    state: await readOptionalText(join(root, backend.files.state)),
    document: await readOptionalText(join(root, backend.files.tasks)),
    full,
    fetch,
  });
  if (!result.ok) {
    return { connector, ok: false, reason: result.reason };
  }
  await writeFile(join(root, backend.files.tasks), result.document, 'utf8');
  await writeFile(join(root, backend.files.state), result.state, 'utf8');
  const { mode, pulled, removed, refusals } = result;
  return { connector, ok: true, mode, pulled, removed, refusals };
}

/**
 * Sync every enabled backend connector of a repository and record the round in the sync log.
 *
 * @param {string} root - Repository root.
 * @param {boolean} full - Force a full sweep on every backend.
 * @param {BackendFetch} fetch - Fetch handed to each module.
 * @param {() => string} now - Current ISO time, stamped on the log entries.
 * @returns {Promise<BackendSyncReport[]>} One report per enabled backend, catalogue order; empty when none is enabled.
 * @throws {Error} When the sync log does not parse, naming the fix; nothing is pulled.
 */
export async function syncRepoBackends(
  root: string,
  full: boolean,
  fetch: BackendFetch,
  now: () => string,
): Promise<BackendSyncReport[]> {
  const logPath = join(root, SYNC_LOG_FILE);
  const log = parseSyncLog(await readOptionalText(logPath));
  if (!log.ok) {
    throw new Error(log.reason);
  }
  const config = await createNodeConfigDocument(root).read();
  const reports: BackendSyncReport[] = [];
  for (const step of backendSyncPlan(config)) {
    reports.push(
      step.ok ? await runStep(root, step, full, fetch) : { connector: step.connector, ok: false, reason: step.reason },
    );
  }
  if (reports.length > 0) {
    await writeFile(logPath, recordSyncs(log.last, reports, now()), 'utf8');
  }
  return reports;
}
