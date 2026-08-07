/**
 * PAW Live Herd Opener
 *
 * @fileoverview The I/O shell a face calls to run a live herd through the SDK
 * egress: it loads `DEEPSEEK_*` from the nearest `.env.local`, opens a temporary
 * runtime home, and builds a live SDK-backed {@link RoleRegistry} for the plan —
 * returning it with a `close` that stops the shared client and removes the home.
 * This is the one call the CLI needs; the lifecycle (start once, dispatch the
 * concurrent pool, stop once) lives here rather than smeared across the faces.
 * Excluded from unit coverage in `vitest.config.ts`: it reads the environment,
 * walks the filesystem, and spawns the 159 MB Copilot runtime via
 * {@link openSdkModel}. Its collaborators — {@link parseDeepseekEnv},
 * {@link liveSdkRegistryFor}, and the egress cores — are unit-covered to 100%,
 * and a live run is the integration proof.
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
 * Lift `DEEPSEEK_*` from the nearest `.env.local` into the process environment,
 * walking up from a starting directory. Existing values are never overwritten,
 * and nothing is logged — the key lives only in `process.env`, read at egress.
 *
 * @param {string} startDir - Directory to begin the upward search from.
 * @returns {Promise<void>} Resolves once the file is found and applied, or the root is reached.
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
 * Open a live SDK-backed registry for a plan, ready to dispatch.
 *
 * @param {SwarmPlan<unknown>} plan - The plan being run.
 * @param {string} [cwd] - Where to look for `.env.local`; defaults to the process cwd.
 * @returns {Promise<LiveSdkRegistry>} The registry and a close hook that stops the client and cleans the runtime home.
 */
export async function openLiveHerd(
  plan: SwarmPlan<unknown>,
  cwd: string = process.cwd(),
): Promise<LiveSdkRegistry> {
  await loadEnvLocal(cwd);
  const baseDirectory = await mkdtemp(join(tmpdir(), 'paw-herd-'));
  const { registry, close } = await liveSdkRegistryFor(plan, openSdkModel, { baseDirectory });
  return {
    registry,
    close: async () => {
      await close();
      await rm(baseDirectory, { recursive: true, force: true });
    },
  };
}
