/**
 * PAW Apply Init
 *
 * @fileoverview Attach PAW to repo: read existing config, plan against it, write result. Sequence only; decision about existing config belong to {@link resolveInit}, bytes to {@link planInit}. Hold no rules own. Live in core; `paw-setup init` (terminal), `paw ui` (operator approval), and desktop shell (dialog) attach repo through this one use-case.
 *
 * @module @paw/core/application/applyInit
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  configPathFor,
  ignorePathFor,
  planInit,
  type InitPlan,
} from '../domain/initScaffold.js';
import type { InitMode } from '../domain/initConfig.js';
import { dirNameOf } from '../domain/paths.js';
import type { FileSystemPort } from '../ports/index.js';

/**
 * Plan an attach against repo root's existing config and `.paw/.gitignore`; write nothing.
 *
 * @param {string} root - The repo root.
 * @param {FileSystemPort} fs - Filesystem port; only read.
 * @param {InitMode} mode - How to resolve existing config.
 * @returns {Promise<InitPlan>} The plan an attach would write.
 * @throws {Error} When existing config present but unreadable.
 */
export async function readInitPlan(
  root: string,
  fs: FileSystemPort,
  mode: InitMode,
): Promise<InitPlan> {
  const existing = await fs.readText(configPathFor(root));
  const ignore = await fs.readText(ignorePathFor(root));
  return planInit(root, existing === '' ? null : existing, mode, ignore);
}

/**
 * Attach PAW to repo root; return executed plan.
 *
 * Read existing config first; plan refuse to replace one PAW no write. Refused plan still write git hook and ignore file, and report refusal on returned plan; caller decide how to surface it.
 *
 * @param {string} root - The repo root.
 * @param {FileSystemPort} fs - Filesystem port.
 * @param {InitMode} [mode] - How to resolve existing config; default refuse.
 * @returns {Promise<InitPlan>} The plan that was written.
 * @throws {Error} When existing config present but unreadable.
 */
export async function applyInit(
  root: string,
  fs: FileSystemPort,
  mode: InitMode = 'create',
): Promise<InitPlan> {
  const plan = await readInitPlan(root, fs, mode);
  for (const write of plan.writes) {
    await fs.ensureDir(dirNameOf(write.path));
    await fs.writeText(write.path, write.content);
    if (write.executable) {
      await fs.setExecutable(write.path);
    }
  }
  return plan;
}
