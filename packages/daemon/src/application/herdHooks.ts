/**
 * PAW Herd Hooks
 *
 * @fileoverview Session hooks a herd's SDK sessions carry, so pawd polices
 * members the way it polices an editor agent. Each hook relays its canonical
 * event to pawd through an injected dispatch and returns pawd's answer, already
 * in the SDK hook output shape. Fails open: no answer or a throw returns
 * nothing, which the SDK reads as allow, and reports the reason.
 *
 * @module @paw/daemon/application/herdHooks
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { PawEventType } from '@paw/core';

/**
 * Relay one canonical event to pawd.
 *
 * @callback HerdDispatch
 * @param {PawEventType} event - Canonical event.
 * @param {Record<string, unknown>} payload - What the `sdk-hooks` connector reads.
 * @returns {Promise<unknown>} Pawd's answer, or null when pawd gave none.
 */
export type HerdDispatch = (event: PawEventType, payload: Record<string, unknown>) => Promise<unknown>;

/**
 * SDK hook input for a tool call.
 *
 * @interface HerdToolInput
 * @property {string} toolName - SDK tool name.
 * @property {unknown} toolArgs - Tool arguments.
 */
export interface HerdToolInput {
  readonly toolName: string;
  readonly toolArgs: unknown;
}

/**
 * SDK hook invocation context.
 *
 * @interface HerdInvocation
 * @property {string} sessionId - Session of the member that fired the hook.
 */
export interface HerdInvocation {
  readonly sessionId: string;
}

/**
 * The SDK session hooks a herd registers.
 *
 * @interface HerdHooks
 * @property {(input: HerdToolInput, invocation: HerdInvocation) => Promise<Record<string, unknown> | undefined>} onPreToolUse - Before a tool runs; may deny it.
 * @property {(input: HerdToolInput, invocation: HerdInvocation) => Promise<Record<string, unknown> | undefined>} onPostToolUse - After a tool succeeds; gates run on what it edited.
 * @property {(input: HerdToolInput, invocation: HerdInvocation) => Promise<Record<string, unknown> | undefined>} onPostToolUseFailure - After a tool fails.
 * @property {(input: { prompt: string }, invocation: HerdInvocation) => Promise<Record<string, unknown> | undefined>} onUserPromptSubmitted - When the member's brief is submitted.
 */
export interface HerdHooks {
  onPreToolUse(input: HerdToolInput, invocation: HerdInvocation): Promise<Record<string, unknown> | undefined>;
  onPostToolUse(input: HerdToolInput, invocation: HerdInvocation): Promise<Record<string, unknown> | undefined>;
  onPostToolUseFailure(input: HerdToolInput, invocation: HerdInvocation): Promise<Record<string, unknown> | undefined>;
  onUserPromptSubmitted(input: { prompt: string }, invocation: HerdInvocation): Promise<Record<string, unknown> | undefined>;
}

/**
 * Build the hooks a herd's sessions carry.
 *
 * @param {HerdDispatch} dispatch - Relays one event to pawd.
 * @param {(reason: string) => void} onFailure - Receives why a hook allowed without enforcement.
 * @param {boolean} gates - False relays no post-tool event, so no gate runs and no violation is raised; pre-tool still relays, so the secrets rule holds.
 * @returns {HerdHooks} The SDK session hooks.
 */
export function createHerdHooks(
  dispatch: HerdDispatch,
  onFailure: (reason: string) => void,
  gates: boolean,
): HerdHooks {
  const relay = async (
    event: PawEventType,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> => {
    let answer: unknown;
    try {
      answer = await dispatch(event, payload);
    } catch (err: unknown) {
      onFailure(`${event}: ${String(err)} · allowed without enforcement`);
      return undefined;
    }
    if (answer === null) {
      onFailure(`${event}: pawd gave no answer · allowed without enforcement`);
      return undefined;
    }
    return answer as Record<string, unknown>;
  };
  const tool = (input: HerdToolInput, invocation: HerdInvocation): Record<string, unknown> => ({
    sessionId: invocation.sessionId,
    toolName: input.toolName,
    toolArgs: input.toolArgs,
  });
  const post = (input: HerdToolInput, invocation: HerdInvocation, failed: boolean) =>
    gates ? relay('tool.post', { ...tool(input, invocation), failed }) : Promise.resolve(undefined);
  return {
    onPreToolUse: (input, invocation) => relay('tool.pre', tool(input, invocation)),
    onPostToolUse: (input, invocation) => post(input, invocation, false),
    onPostToolUseFailure: (input, invocation) => post(input, invocation, true),
    onUserPromptSubmitted: (input, invocation) =>
      relay('prompt.submitted', { sessionId: invocation.sessionId, prompt: input.prompt }),
  };
}
