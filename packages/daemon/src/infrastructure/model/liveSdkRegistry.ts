/**
 * PAW Live SDK Registry
 *
 * @fileoverview Builds a {@link RoleRegistry} whose port issues real completions
 * through PAW's daemon-owned SDK egress — the replacement for the vendored raw
 * DeepSeek runtime. It opens one shared Copilot client (the injected
 * {@link OpenModel}, `openSdkModel` in production), binds the plan's role to the
 * live model, and hands back the client's `close` so a run can shut the runtime
 * down when the herd finishes. DeepSeek is the default target expressed as data
 * (`baseUrl` + model, overridable by env or argument), not a code path; the key
 * is read from the environment lazily at egress and never held here. Fails loud
 * per CONSTRAINTS.md Constraint 3: a run with no key throws at the first call.
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
import type { OpenSdkModelOptions } from './sdkModel.js';

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

/**
 * The capabilities the live model is declared to have, so a role that requires
 * tools, structured output, or a large window is satisfied by the binding.
 */
const LIVE_CAPS: ModelCapabilities = {
  contextTokens: 128_000,
  maxOutputTokens: 8_192,
  tools: true,
  structuredOutput: true,
  reasoning: true,
  vision: false,
  costClass: 'cheap',
};

/**
 * Opens a shared SDK-backed model. `openSdkModel` in production; a fake in tests.
 *
 * @callback OpenModel
 * @param {OpenSdkModelOptions} options - Provider, key source, and runtime home.
 * @returns {Promise<{ port: ModelPort; close: () => Promise<void> }>} The port and its stop hook.
 */
export type OpenModel = (
  options: OpenSdkModelOptions,
) => Promise<{ port: ModelPort; close: () => Promise<void> }>;

/**
 * A live registry paired with the hook that stops its client.
 *
 * @interface LiveSdkRegistry
 * @property {RoleRegistry} registry - The plan's role bound to the live model.
 * @property {() => Promise<void>} close - Stops the shared client; call once the herd is done.
 */
export interface LiveSdkRegistry {
  readonly registry: RoleRegistry;
  readonly close: () => Promise<void>;
}

/**
 * Build a live registry for a plan, routing completions through the SDK egress.
 *
 * @param {SwarmPlan<unknown>} plan - The plan being run.
 * @param {OpenModel} openModel - Opens the shared SDK model.
 * @param {object} opts - Overrides and the runtime home.
 * @param {string} opts.baseDirectory - Where the runtime writes session state.
 * @param {string} [opts.baseUrl] - Provider base URL; defaults to `DEEPSEEK_BASE_URL` or the public endpoint.
 * @param {string} [opts.model] - Model id; defaults to `DEEPSEEK_MODEL` or `deepseek-chat`.
 * @returns {Promise<LiveSdkRegistry>} The registry and its close hook.
 */
export async function liveSdkRegistryFor(
  plan: SwarmPlan<unknown>,
  openModel: OpenModel,
  opts: { baseDirectory: string; baseUrl?: string; model?: string },
): Promise<LiveSdkRegistry> {
  const baseUrl = opts.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE;
  const modelId = opts.model ?? process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;
  const { port, close } = await openModel({
    provider: { type: 'openai', baseUrl },
    authToken: () => {
      const key = process.env.DEEPSEEK_KEY;
      if (key === undefined || key === '') {
        throw new Error('DEEPSEEK_KEY is not set; cannot run a live herd');
      }
      return key;
    },
    baseDirectory: opts.baseDirectory,
  });
  const registry = buildRegistry(
    { models: { [modelId]: LIVE_CAPS }, roles: { [plan.role]: modelId } },
    (): ModelPort => port,
  );
  return { registry, close };
}
