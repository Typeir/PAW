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
  planInit,
  type InitPlan,
} from '../domain/initScaffold.js';
import type { InitMode } from '../domain/initConfig.js';
import { dirNameOf } from '../domain/paths.js';
import type { FileSystemPort } from '../ports/index.js';

/**
 * Attach PAW to repo root; return executed plan.
 *
 * Read existing config first; plan refuse to replace one PAW no write. Refused plan still write git hook and report refusal on returned plan; caller decide how to surface it.
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
  const existing = await fs.readText(configPathFor(root));
  const plan = planInit(root, existing === '' ? null : existing, mode);
  for (const write of plan.writes) {
    await fs.ensureDir(dirNameOf(write.path));
    await fs.writeText(write.path, write.content);
    if (write.executable) {
      await fs.setExecutable(write.path);
    }
  }
  return plan;
}
