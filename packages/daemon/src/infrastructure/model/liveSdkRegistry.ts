/**
 * PAW live SDK registry
 *
 * @fileoverview Build {@link RoleRegistry}. Route issue completions
 * through PAW daemon-owned SDK egress. Open one shared Copilot client (the
 * injected {@link OpenModel}, `openSdkModel` in production), bind plan role to
 * live model, return client `close` so run can stop the runtime when the run
 * finishes. Wire type, endpoint, model, and key come from the run's
 * {@link ProviderProfile}; `baseUrl` and `model` arguments override. The
 * model's capabilities come from its `.paw/config.json` declaration. The key is
 * handed to egress through the token callback only. A run with no model id, or
 * whose model the config does not declare validly, throws before the runtime opens.
 *
 * @module @paw/daemon/model/liveSdkRegistry
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  buildRegistry,
  parseCapabilities,
  type ModelPort,
  type PlanBinding,
  type RoleRegistry,
  type SwarmPlan,
} from '@paw/core';
import type { ProviderProfile } from './providerEnv.js';
import type { OpenSdkModelOptions } from './sdkModel.js';

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
 * Model a live run bind to and its declared capabilities. The id is the
 * explicit override, else the provider's `MODEL`; the capabilities are that
 * id's entry in the config's `models`. Same resolution
 * {@link liveSdkRegistryFor} apply, reachable without opening the runtime.
 *
 * @param {object} opts - Provider, override, and declared models.
 * @param {ProviderProfile} opts.provider - Provider from a `.paw/<name>.provider.env`.
 * @param {string} [opts.model] - Model id override.
 * @param {Readonly<Record<string, unknown>> | undefined} opts.models - `models` from `.paw/config.json`; undefined when it declares none.
 * @returns {PlanBinding} Model id and its capabilities.
 * @throws {Error} When no model id is resolved, the config does not declare it, or its declaration is malformed.
 */
export function liveBinding(opts: {
  provider: ProviderProfile;
  model?: string;
  models: Readonly<Record<string, unknown>> | undefined;
}): PlanBinding {
  const modelId = opts.model ?? opts.provider.model;
  if (modelId === undefined) {
    const name = opts.provider.name;
    throw new Error(`provider "${name}" names no model: add MODEL to .paw/${name}.provider.env`);
  }
  const declared = opts.models?.[modelId];
  if (declared === undefined) {
    throw new Error(
      `model "${modelId}" is not declared in .paw/config.json; declare it with ` +
        `paw config model ${modelId} --context N --max-output N --cost <tier>`,
    );
  }
  const parsed = parseCapabilities(declared);
  if (!parsed.ok) {
    throw new Error(`model "${modelId}" in .paw/config.json: ${parsed.reason}`);
  }
  return { modelId, capabilities: parsed.capabilities };
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
 * @param {Readonly<Record<string, unknown>> | undefined} opts.models - `models` from `.paw/config.json`; supplies the bound model's capabilities.
 * @param {string} [opts.baseUrl] - Base URL override; else the provider's.
 * @param {string} [opts.model] - Model id override; else the provider's.
 * @returns {Promise<LiveSdkRegistry>} Registry and its close hook.
 * @throws {Error} When {@link liveBinding} refuses; the runtime is not opened.
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
    models: Readonly<Record<string, unknown>> | undefined;
    baseUrl?: string;
    model?: string;
  },
): Promise<LiveSdkRegistry> {
  const profile = opts.provider;
  const { modelId, capabilities } = liveBinding(opts);
  const { port, close } = await openModel({
    provider: { type: profile.type, baseUrl: opts.baseUrl ?? profile.baseUrl },
    authToken: () => profile.key,
    baseDirectory: opts.baseDirectory,
    workingDirectory: opts.workingDirectory,
    safemode: opts.safemode,
    hooks: opts.hooks,
  });
  const registry = buildRegistry(
    { models: { [modelId]: capabilities }, roles: { [plan.role]: modelId } },
    (): ModelPort => port,
  );
  return { registry, close };
}
