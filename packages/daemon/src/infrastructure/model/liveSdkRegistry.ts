/**
 * PAW live SDK registry
 *
 * @fileoverview Build {@link RoleRegistry}. Route issue completions
 * through PAW daemon-owned SDK egress. Open one shared Copilot client (the
 * injected {@link OpenModel}, `openSdkModel` in production), bind plan role to
 * live model, return client `close` so run can stop the runtime when the run
 * finishes. Wire type, endpoint, model, and key come from the run's
 * {@link ProviderProfile}; `baseUrl` and `model` arguments override. The key is
 * handed to egress through the token callback only. A run with no model id
 * throws before the runtime opens.
 *
 * @module @paw/daemon/model/liveSdkRegistry
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  buildRegistry,
  type ModelCapabilities,
  type ModelPort,
  type RoleRegistry,
  type SwarmPlan,
} from '@paw/core';
import type { ProviderProfile } from './providerEnv.js';
import type { OpenSdkModelOptions } from './sdkModel.js';

/**
 * Capabilities live model declared to have, so role that require
 * tools, structured output, or large window satisfied by binding.
 * `maxOutputTokens` is the ceiling the provider actually serves; a role
 * requiring more than this is refused by the plan doctor before dispatch.
 */
export const LIVE_CAPS: ModelCapabilities = {
  contextTokens: 128_000,
  maxOutputTokens: 8_192,
  tools: true,
  structuredOutput: true,
  reasoning: true,
  vision: false,
  costClass: 'cheap',
};

/**
 * Open shared SDK-backed model. `openSdkModel` in production; fake in tests.
 *
 * @callback OpenModel
 * @param {OpenSdkModelOptions} options - Provider, key source, runtime home.
 * @returns {Promise<{ port: ModelPort; close: () => Promise<void> }>} Port and its stop hook.
 */
export type OpenModel = (
  options: OpenSdkModelOptions,
) => Promise<{ port: ModelPort; close: () => Promise<void> }>;

/**
 * Model id a live run bind to: explicit override, else the provider's `MODEL`.
 * Same precedence {@link liveSdkRegistryFor} apply, reachable without opening the runtime.
 *
 * @param {object} opts - Provider and override.
 * @param {ProviderProfile} opts.provider - Provider from a `.paw/<name>.provider.env`.
 * @param {string} [opts.model] - Model id override.
 * @returns {string} Resolved model id.
 * @throws {Error} When neither the override nor the provider names a model.
 */
export function liveModelId(opts: { provider: ProviderProfile; model?: string }): string {
  const id = opts.model ?? opts.provider.model;
  if (id === undefined) {
    const name = opts.provider.name;
    throw new Error(`provider "${name}" names no model: add MODEL to .paw/${name}.provider.env`);
  }
  return id;
}

/**
 * Live registry paired with hook that stop its client.
 *
 * @interface LiveSdkRegistry
 * @property {RoleRegistry} registry - Plan role bound to live model.
 * @property {() => Promise<void>} close - Stop shared client; call once the run finishes.
 */
export interface LiveSdkRegistry {
  readonly registry: RoleRegistry;
  readonly close: () => Promise<void>;
}

/**
 * Build live registry for plan, route completions through SDK egress.
 *
 * @param {SwarmPlan<unknown>} plan - Plan being run.
 * @param {OpenModel} openModel - Open shared SDK model.
 * @param {object} opts - Overrides, runtime home, agentic surface.
 * @param {string} opts.baseDirectory - Where runtime write session state.
 * @param {string} opts.workingDirectory - Absolute root members built-in tools operate within; served repository.
 * @param {boolean} opts.safemode - When true, members denied shell — option-A surface.
 * @param {unknown} opts.hooks - SDK session hooks every member session carries; the herd passes pawd's.
 * @param {ProviderProfile} opts.provider - Provider from a `.paw/<name>.provider.env`; sets wire type, endpoint, default model, and key.
 * @param {string} [opts.baseUrl] - Base URL override; else the provider's.
 * @param {string} [opts.model] - Model id override; else the provider's.
 * @returns {Promise<LiveSdkRegistry>} Registry and its close hook.
 * @throws {Error} When no model id is resolved; the runtime is not opened.
 */
export async function liveSdkRegistryFor(
  plan: SwarmPlan<unknown>,
  openModel: OpenModel,
  opts: {
    baseDirectory: string;
    workingDirectory: string;
    safemode: boolean;
    hooks: unknown;
    provider: ProviderProfile;
    baseUrl?: string;
    model?: string;
  },
): Promise<LiveSdkRegistry> {
  const profile = opts.provider;
  const modelId = liveModelId(opts);
  const { port, close } = await openModel({
    provider: { type: profile.type, baseUrl: opts.baseUrl ?? profile.baseUrl },
    authToken: () => profile.key,
    baseDirectory: opts.baseDirectory,
    workingDirectory: opts.workingDirectory,
    safemode: opts.safemode,
    hooks: opts.hooks,
  });
  const registry = buildRegistry(
    { models: { [modelId]: LIVE_CAPS }, roles: { [plan.role]: modelId } },
    (): ModelPort => port,
  );
  return { registry, close };
}
