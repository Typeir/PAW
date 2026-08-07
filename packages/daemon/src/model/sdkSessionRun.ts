/**
 * PAW SDK Session Run
 *
 * @fileoverview The orchestration core of PAW's SDK-backed model port: one
 * tool-less BYOK completion on a shared, already-started Copilot client. It is
 * kept free of the SDK itself — the client is an injected {@link SdkClientLike} —
 * so the session lifecycle and the usage correlation are unit-covered without
 * spawning the runtime; the thin wiring that supplies a real client is the
 * excluded shell. The SDK exposes no token usage on its reply, so usage is read
 * from a map the egress fills as it performs each call, keyed by the session id
 * the request carried. A completion whose usage never arrived throws rather than
 * reporting zero, per CONSTRAINTS.md Constraint 3, and the session is always
 * disconnected — the client stays up for the next completion in the pool.
 *
 * @module @paw/daemon/model/sdkSessionRun
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { SessionRun } from '@paw/adapters';
import type { ModelRequest } from '@paw/core';
import type { TokenUsage } from './providerUsage.js';

/**
 * The slice of a Copilot session the run drives.
 *
 * @interface SdkSessionLike
 * @property {string} sessionId - The session's id, the key usage is correlated by.
 * @property {(message: { prompt: string }, timeoutMs: number) => Promise<{ data?: { content?: string | null } } | undefined>} sendAndWait - Send the prompt and await the assistant reply.
 * @property {() => Promise<void>} disconnect - Release the session, leaving the client running.
 */
export interface SdkSessionLike {
  readonly sessionId: string;
  sendAndWait(
    message: { prompt: string },
    timeoutMs: number,
  ): Promise<{ data?: { content?: string | null } } | undefined>;
  disconnect(): Promise<void>;
}

/**
 * The slice of a Copilot client the run needs — a shared instance, already started.
 *
 * @interface SdkClientLike
 * @property {(options: Record<string, unknown>) => Promise<SdkSessionLike>} createSession - Open a session for one completion.
 */
export interface SdkClientLike {
  createSession(options: Record<string, unknown>): Promise<SdkSessionLike>;
}

/**
 * A BYOK provider target: wire format and endpoint. No key — the key is added at
 * egress by the request handler, never in the session's provider block.
 *
 * @interface ProviderBlock
 * @property {'openai' | 'azure' | 'anthropic'} type - The provider wire format.
 * @property {string} baseUrl - The provider endpoint.
 */
export interface ProviderBlock {
  readonly type: 'openai' | 'azure' | 'anthropic';
  readonly baseUrl: string;
}

const DEFAULT_DEADLINE_MS = 120_000;

/**
 * Build a {@link SessionRun} that runs one tool-less completion per call on a
 * shared client, reading usage from `usageBySession`.
 *
 * @param {SdkClientLike} client - The shared, already-started client.
 * @param {ProviderBlock} provider - The BYOK provider target.
 * @param {Map<string, TokenUsage>} usageBySession - Usage the egress records, keyed by session id.
 * @param {number} [deadlineMs] - Wall-clock ceiling for one completion.
 * @returns {SessionRun} The provider boundary a model port wraps.
 */
export function createSdkSessionRun(
  client: SdkClientLike,
  provider: ProviderBlock,
  usageBySession: Map<string, TokenUsage>,
  deadlineMs: number = DEFAULT_DEADLINE_MS,
): SessionRun {
  return async (request: ModelRequest) => {
    const session = await client.createSession({
      model: request.model,
      provider: { type: provider.type, baseUrl: provider.baseUrl },
      availableTools: [],
      skipCustomInstructions: true,
      enableConfigDiscovery: false,
      streaming: false,
    });
    try {
      const reply = await session.sendAndWait({ prompt: request.prompt }, deadlineMs);
      const usage = usageBySession.get(session.sessionId);
      if (usage === undefined) {
        throw new Error(
          `no usage recorded for session ${session.sessionId}; egress did not observe the model call`,
        );
      }
      usageBySession.delete(session.sessionId);
      return {
        content: reply?.data?.content ?? '',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      };
    } finally {
      await session.disconnect();
    }
  };
}
