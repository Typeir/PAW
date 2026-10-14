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

import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { PlanBinding, SwarmPlan } from '@paw/core';
import { createHerdHooks, type HerdHooks } from '../../application/herdHooks.js';
import { socketPath, tokenPath } from '../endpoint.js';
import { rpcCall } from '../rpcClient.js';
import { parseDeepseekEnv } from './envLocal.js';
import {
  chooseProvider,
  parseProviderEnv,
  providerNameOf,
  type ProviderProfile,
} from './providerEnv.js';
import {
  LIVE_CAPS,
  liveModelId,
  liveSdkRegistryFor,
  type LiveSdkRegistry,
} from './liveSdkRegistry.js';
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
 * Providers configured in `<root>/.paw/*.provider.env`, parsed, by name. An
 * empty map when the directory holds none.
 *
 * @param {string} root - Consumer repo root.
 * @returns {Promise<Map<string, ProviderProfile>>} Providers by name.
 */
async function loadProviders(root: string): Promise<Map<string, ProviderProfile>> {
  const providers = new Map<string, ProviderProfile>();
  const pawDir = join(root, '.paw');
  if (!existsSync(pawDir)) {
    return providers;
  }
  for (const file of readdirSync(pawDir)) {
    const name = providerNameOf(basename(file));
    if (name !== null) {
      providers.set(name, parseProviderEnv(name, await readFile(join(pawDir, file), 'utf8')));
    }
  }
  return providers;
}

/**
 * Provider a live run in `cwd` would use: `.env.local`, then
 * `.paw/*.provider.env`, then `PAW_PROVIDER`. Shared by the run path and the
 * doctor path, which differ only in whether they open the runtime.
 *
 * @param {string} cwd - Repository root.
 * @returns {Promise<ProviderProfile | undefined>} Chosen provider, or undefined when none is configured.
 */
async function resolveProvider(cwd: string): Promise<ProviderProfile | undefined> {
  await loadEnvLocal(cwd);
  const providers = await loadProviders(cwd);
  return providers.size === 0
    ? undefined
    : chooseProvider(providers, process.env.PAW_PROVIDER);
}

/**
 * Model a live run would bind to and the capabilities it declares, resolved
 * without opening the 159 MB runtime. Lets `paw swarm doctor --live` judge the
 * plan's role against the model that would serve it, instead of that shortfall
 * surfacing at dispatch.
 *
 * @param {string} [cwd] - Repository root; default to process cwd.
 * @returns {Promise<PlanBinding>} Model id and its declared capabilities.
 */
export async function liveHerdBinding(cwd: string = process.cwd()): Promise<PlanBinding> {
  const provider = await resolveProvider(cwd);
  return {
    modelId: liveModelId(provider === undefined ? {} : { provider }),
    capabilities: LIVE_CAPS,
  };
}

/**
 * Hooks that put every member session under the pawd serving `root`. The
 * caller starts that pawd; while it is down each hook allows and writes why to
 * stderr.
 *
 * @param {string} root - Repository root pawd serves.
 * @returns {HerdHooks} SDK session hooks relaying to pawd as host `sdk`.
 */
function pawdHooks(root: string): HerdHooks {
  const endpoint = socketPath(root, {
    platform: process.platform,
    xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
    tmpdir: tmpdir(),
  });
  const token = tokenPath(join(root, '.paw'));
  return createHerdHooks(
    (event, payload) => rpcCall(endpoint, token, 'hook.dispatch', { host: 'sdk', event, payload }),
    (reason) => process.stderr.write(`paw herd: ${reason}\n`),
  );
}

/**
 * Open live SDK-backed registry for plan, ready to dispatch. Members run SDK
 * built-in tools in place, rooted at `cwd`, and every member session carries
 * pawd's hooks, so gates and the secrets rule apply to members.
 *
 * @param {SwarmPlan<unknown>} plan - Plan being run.
 * @param {string} [cwd] - Where look for `.env.local`, the root members' tools operate within, and the repo whose pawd polices them; default to process cwd.
 * @param {object} [opts] - Agentic surface.
 * @param {boolean} [opts.safemode] - When true, deny members the shell — option-A surface. Default false, full built-in set.
 * @returns {Promise<LiveSdkRegistry>} Registry and close hook that stop client and clean runtime home.
 */
export async function openLiveHerd(
  plan: SwarmPlan<unknown>,
  cwd: string = process.cwd(),
  opts: { safemode?: boolean } = {},
): Promise<LiveSdkRegistry> {
  const provider = await resolveProvider(cwd);
  const baseDirectory = await mkdtemp(join(tmpdir(), 'paw-herd-'));
  const { registry, close } = await liveSdkRegistryFor(plan, openSdkModel, {
    baseDirectory,
    workingDirectory: cwd,
    safemode: opts.safemode ?? false,
    hooks: pawdHooks(cwd),
    ...(provider === undefined ? {} : { provider }),
  });
  return {
    registry,
    close: async () => {
      await close();
      await rm(baseDirectory, { recursive: true, force: true });
    },
  };
}
