/**
 * PAW Live DeepSeek Runtime
 *
 * @fileoverview The real, network-backed model runtime for a live herd — the
 * DeepSeek OpenAI-compatible endpoint expressed as a {@link SessionRun} behind the
 * unchanged {@link createCopilotSdkModel} port seam, so the herder provider is one
 * swappable function and every layer above it (dispatch, roles, core) is untouched
 * whether the model is fake, DeepSeek, or a Copilot-SDK BYOK session. This is the
 * driven I/O the consumer owns, the runtime counterpart of `main.ts`: excluded
 * from unit coverage and proven by the opt-in integration test. The API key is
 * read from the process environment at egress and never passed as an argument,
 * never logged, and never placed in a model prompt; the loader only ever reads
 * `DEEPSEEK_*` names out of `.env.local`. Fails loud per CONSTRAINTS.md Constraint
 * 3: a missing key or a non-2xx response throws rather than returning empty text.
 *
 * @module @paw/cli/deepseekRuntime
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createCopilotSdkModel, type SessionRun } from '@paw/adapters';
import {
  buildRegistry,
  type ModelCapabilities,
  type ModelPort,
  type RoleRegistry,
  type SwarmPlan,
} from '@paw/core';

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

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
 * Load `DEEPSEEK_*` variables from the nearest `.env.local` into the process
 * environment, walking up from a starting directory. Only DeepSeek names are
 * lifted, existing values are never overwritten, and nothing is logged — the key
 * lives only in `process.env`, read at egress.
 *
 * @param {string} startDir - Directory to begin the upward search from.
 * @returns {Promise<void>} Resolves once the file is found and applied, or the filesystem root is reached.
 */
export async function loadEnvLocal(startDir: string): Promise<void> {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, '.env.local');
    if (existsSync(candidate)) {
      const text = await readFile(candidate, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const match = /^\s*(DEEPSEEK_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (match && process.env[match[1]] === undefined) {
          process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
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
 * Create a {@link SessionRun} that runs one completion against DeepSeek's
 * OpenAI-compatible chat endpoint. The key is read from `process.env.DEEPSEEK_KEY`
 * at call time.
 *
 * @param {object} [opts] - Overrides.
 * @param {string} [opts.baseUrl] - API base URL; defaults to `DEEPSEEK_BASE_URL` or the public endpoint.
 * @returns {SessionRun} The provider boundary.
 */
export function createDeepSeekSession(opts?: { baseUrl?: string }): SessionRun {
  const baseUrl = opts?.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE;
  return async (request) => {
    const key = process.env.DEEPSEEK_KEY;
    if (!key) {
      throw new Error('DEEPSEEK_KEY is not set; cannot run a live herd');
    }
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: [{ role: 'user', content: request.prompt }],
        max_tokens: request.maxOutputTokens ?? 512,
        stream: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      choices?: ReadonlyArray<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      content: json.choices?.[0]?.message?.content ?? '',
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    };
  };
}

/**
 * Build a registry that binds a plan's role to a live DeepSeek model through the
 * Copilot-SDK port seam.
 *
 * @param {SwarmPlan<unknown>} plan - The plan being run.
 * @param {object} [opts] - Overrides.
 * @param {string} [opts.baseUrl] - API base URL.
 * @param {string} [opts.model] - DeepSeek model id; defaults to `DEEPSEEK_MODEL` or `deepseek-chat`.
 * @returns {RoleRegistry} A registry whose port issues real completions.
 */
export function liveRegistryFor(
  plan: SwarmPlan<unknown>,
  opts?: { baseUrl?: string; model?: string },
): RoleRegistry {
  const port: ModelPort = createCopilotSdkModel(createDeepSeekSession(opts));
  const modelId = opts?.model ?? process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;
  return buildRegistry(
    { models: { [modelId]: LIVE_CAPS }, roles: { [plan.role]: modelId } },
    () => port,
  );
}
