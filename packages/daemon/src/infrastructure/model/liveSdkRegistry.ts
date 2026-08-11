/**
 * PAW live SDK registry
 *
 * @fileoverview Build {@link RoleRegistry}. Route issue completions
 * through PAW daemon-owned SDK egress — replace vendored raw
 * DeepSeek runtime. Open one shared Copilot client (the injected
 * {@link OpenModel}, `openSdkModel` in production), bind plan role to
 * live model, return client `close` so run can stop the runtime
 * when the run finishes. DeepSeek defaults stored as data
 * (`baseUrl` + model), overridable by env or argument; key
 * read from environment lazily at egress and never held here. Fail loud
 * per CONSTRAINTS.md Constraint 3: run with no key throws at first call.
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
 * Capabilities live model declared to have, so role that require
 * tools, structured output, or large window satisfied by binding.
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
 * @param {string} [opts.baseUrl] - Provider base URL; default `DEEPSEEK_BASE_URL` or public endpoint.
 * @param {string} [opts.model] - Model id; default `DEEPSEEK_MODEL` or `deepseek-chat`.
 * @returns {Promise<LiveSdkRegistry>} Registry and its close hook.
 */
export async function liveSdkRegistryFor(
  plan: SwarmPlan<unknown>,
  openModel: OpenModel,
  opts: { baseDirectory: string; workingDirectory: string; safemode: boolean; baseUrl?: string; model?: string },
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
    workingDirectory: opts.workingDirectory,
    safemode: opts.safemode,
  });
  const registry = buildRegistry(
    { models: { [modelId]: LIVE_CAPS }, roles: { [plan.role]: modelId } },
    (): ModelPort => port,
  );
  return { registry, close };
}
