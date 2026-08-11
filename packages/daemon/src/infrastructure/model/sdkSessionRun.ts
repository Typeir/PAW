/**
 * PAW SDK Session Run
 *
 * @fileoverview Orchestration core of PAW SDK model port. One agentic BYOK
 * completion on shared, started Copilot client. Member run SDK built-in tools
 * (edit, search, shell) in place under working dir — no whole-file-return.
 * Tools resolved per request from plan canonical grant via
 * {@link resolveCopilotTools}; safemode deny shell. Client injected as
 * {@link SdkClientLike}, permission handler opaque; session lifecycle and
 * usage correlation unit-covered without runtime. SDK give no usage on reply,
 * so usage read from map egress
 * fill per call, keyed by session id. Usage never arrive → throw, not zero
 * (CONSTRAINTS.md Constraint 3). Session always disconnect — client stay up for
 * next completion.
 *
 * @module @paw/daemon/model/sdkSessionRun
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { SessionRun } from '@paw/adapters';
import type { ModelRequest } from '@paw/core';
import { resolveCopilotTools } from './copilotTools.js';
import type { TokenUsage } from './providerUsage.js';

/**
 * Slice of Copilot session the run drive.
 *
 * @interface SdkSessionLike
 * @property {string} sessionId - Session id, key usage correlate by.
 * @property {(message: { prompt: string }, timeoutMs: number) => Promise<{ data?: { content?: string | null } } | undefined>} sendAndWait - Send prompt, await assistant reply.
 * @property {() => Promise<void>} disconnect - Release session, leave client running.
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
 * Slice of Copilot client run need — shared instance, already started.
 *
 * @interface SdkClientLike
 * @property {(options: Record<string, unknown>) => Promise<SdkSessionLike>} createSession - Open session for one completion.
 */
export interface SdkClientLike {
  createSession(options: Record<string, unknown>): Promise<SdkSessionLike>;
}

/**
 * BYOK provider target: wire format and endpoint. No key — request handler add
 * key at egress, never in session provider block.
 *
 * @interface ProviderBlock
 * @property {'openai' | 'azure' | 'anthropic'} type - Provider wire format.
 * @property {string} baseUrl - Provider endpoint.
 */
export interface ProviderBlock {
  readonly type: 'openai' | 'azure' | 'anthropic';
  readonly baseUrl: string;
}

/**
 * Run-wide agentic config session open under — constant across all sessions,
 * unlike per-request tool grant.
 *
 * @interface AgentToolConfig
 * @property {string} workingDirectory - Absolute root built-in file/shell tools work in; served repo.
 * @property {boolean} safemode - True → deny shell (option-A surface).
 * @property {unknown} onPermissionRequest - SDK permission handler, forwarded opaque; shell gives `approveAll`.
 */
export interface AgentToolConfig {
  readonly workingDirectory: string;
  readonly safemode: boolean;
  readonly onPermissionRequest: unknown;
}

const DEFAULT_DEADLINE_MS = 600_000;

/**
 * `systemMessage` slice of `createSession` for resolved sections, or nothing.
 * Each section replace runtime own of that id (`customize`); every other
 * section — tool and environment instruction too — stay. Empty/absent → no
 * `systemMessage`, member run on stock system prompt.
 *
 * @param {Readonly<Record<string, string>> | undefined} sections - Resolved sections, id to content.
 * @returns {Record<string, unknown>} A `{ systemMessage }` object, or empty to spread away.
 */
function systemMessageOption(
  sections: Readonly<Record<string, string>> | undefined,
): Record<string, unknown> {
  if (sections === undefined || Object.keys(sections).length === 0) {
    return {};
  }
  const overrides: Record<string, { action: 'replace'; content: string }> = {};
  for (const [id, content] of Object.entries(sections)) {
    overrides[id] = { action: 'replace', content };
  }
  return { systemMessage: { mode: 'customize', sections: overrides } };
}

/**
 * Build a {@link SessionRun} that run one agentic completion per call on
 * shared client — member drive SDK built-in tools in place under
 * `agent.workingDirectory` — read usage from `usageBySession`.
 *
 * @param {SdkClientLike} client - Shared, already-started client.
 * @param {ProviderBlock} provider - BYOK provider target.
 * @param {Map<string, TokenUsage>} usageBySession - Usage egress records, keyed by session id.
 * @param {Map<string, number>} maxTokensBySession - Output ceiling run publish for egress to stamp onto outbound body. SDK forward no `max_tokens` of own, so without this provider generate unbounded.
 * @param {AgentToolConfig} agent - Run-wide working directory, safemode, permission handler.
 * @param {number} [deadlineMs] - Wall-clock ceiling for one completion.
 * @returns {SessionRun} Provider boundary model port wrap.
 */
export function createSdkSessionRun(
  client: SdkClientLike,
  provider: ProviderBlock,
  usageBySession: Map<string, TokenUsage>,
  maxTokensBySession: Map<string, number>,
  agent: AgentToolConfig,
  deadlineMs: number = DEFAULT_DEADLINE_MS,
): SessionRun {
  return async (request: ModelRequest) => {
    const tools = resolveCopilotTools(request.availableTools, agent.safemode);
    const session = await client.createSession({
      model: request.model,
      provider: { type: provider.type, baseUrl: provider.baseUrl },
      workingDirectory: agent.workingDirectory,
      availableTools: tools.availableTools,
      excludedTools: tools.excludedTools,
      onPermissionRequest: agent.onPermissionRequest,
      ...systemMessageOption(request.systemSections),
      skipCustomInstructions: true,
      enableConfigDiscovery: false,
      streaming: false,
    });
    if (request.maxOutputTokens !== undefined) {
      maxTokensBySession.set(session.sessionId, request.maxOutputTokens);
    }
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
      maxTokensBySession.delete(session.sessionId);
      await session.disconnect();
    }
  };
}
