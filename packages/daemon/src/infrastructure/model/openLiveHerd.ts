/**
 * PAW Live Herd Opener
 *
 * @fileoverview Entry point that runs a live herd through the SDK. Loads
 * `DEEPSEEK_*` from nearest `.env.local`, creates a temporary runtime home, and
 * builds a live SDK-backed {@link RoleRegistry} for the plan. Returns the
 * registry with a `close` that stops the shared client and removes the home.
 * Single-call CLI entry. Lifecycle (start once, dispatch a concurrent pool,
 * stop once) is handled here.
 * Excluded from unit coverage in `vitest.config.ts`: reads environment, walks
 * the filesystem, and spawns the 159 MB Copilot runtime via
 * {@link openSdkModel}.
 * Collaborators — {@link parseDeepseekEnv}, {@link liveSdkRegistryFor}, and
 * egress cores — unit-covered to 100%. Live run verifies integration.
 *
 * @module @paw/daemon/model/openLiveHerd
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SwarmPlan } from '@paw/core';
import { parseDeepseekEnv } from './envLocal.js';
import { liveSdkRegistryFor, type LiveSdkRegistry } from './liveSdkRegistry.js';
import { openSdkModel } from './sdkModel.js';

/**
 * Loads `DEEPSEEK_*` from nearest `.env.local` into process environment, searching
 * upward from starting directory. Never overwrites an existing value. Logs
 * nothing — the value lives only in `process.env`, read at egress.
 *
 * @param {string} startDir - Directory where upward search begin.
 * @returns {Promise<void>} Resolve once find and apply file, or reach root.
 */
async function loadEnvLocal(startDir: string): Promise<void> {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, '.env.local');
    if (existsSync(candidate)) {
      for (const [name, value] of parseDeepseekEnv(await readFile(candidate, 'utf8'))) {
        if (process.env[name] === undefined) {
          process.env[name] = value;
        }
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return;
    }
    dir = parent;
  }
}

/**
 * Open live SDK-backed registry for plan, ready to dispatch. Members run SDK
 * built-in tools in place, rooted at `cwd` — served repository.
 *
 * @param {SwarmPlan<unknown>} plan - Plan being run.
 * @param {string} [cwd] - Where look for `.env.local` and root members' tools operate within; default to process cwd.
 * @param {object} [opts] - Agentic surface.
 * @param {boolean} [opts.safemode] - When true, deny members the shell — option-A surface. Default false, full built-in set.
 * @returns {Promise<LiveSdkRegistry>} Registry and close hook that stop client and clean runtime home.
 */
export async function openLiveHerd(
  plan: SwarmPlan<unknown>,
  cwd: string = process.cwd(),
  opts: { safemode?: boolean } = {},
): Promise<LiveSdkRegistry> {
  await loadEnvLocal(cwd);
  const baseDirectory = await mkdtemp(join(tmpdir(), 'paw-herd-'));
  const { registry, close } = await liveSdkRegistryFor(plan, openSdkModel, {
    baseDirectory,
    workingDirectory: cwd,
    safemode: opts.safemode ?? false,
  });
  return {
    registry,
    close: async () => {
      await close();
      await rm(baseDirectory, { recursive: true, force: true });
    },
  };
}
