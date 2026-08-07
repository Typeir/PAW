/**
 * PAW Apply Init
 *
 * @fileoverview Attaching PAW to a repository: read whatever config is already
 * there, plan against it, and write the result. Sequencing only — the decision
 * about an existing config belongs to {@link resolveInit} and the bytes belong
 * to {@link planInit}; this holds no rules of its own.
 *
 * It lives in core rather than in the installer because more than one surface
 * attaches repositories. `paw-setup init` does it from a terminal, `paw ui` does
 * it when an operator approves a console's request, and a desktop shell will do
 * it from a dialog. One use-case behind one port means those three cannot drift
 * into three subtly different attaches.
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
 * Attach PAW to a repo root, returning the plan that was executed.
 *
 * Reads any existing config first so the plan can refuse to replace one PAW did
 * not write. A refused plan still writes the git hook and reports the refusal on
 * the returned plan — the caller decides how loudly to say so, because a
 * terminal, a console and a dialog each say it differently.
 *
 * @param {string} root - The repo root.
 * @param {FileSystemPort} fs - Filesystem port.
 * @param {InitMode} [mode] - How to resolve an existing config; defaults to refusing.
 * @returns {Promise<InitPlan>} The plan that was written.
 * @throws {Error} When an existing config is present but unreadable.
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
