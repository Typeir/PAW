/**
 * Herd Hooks Tests
 *
 * @fileoverview Pin the bridge between a herd session's SDK hooks and pawd:
 * each hook relays its canonical event and payload, passes pawd's answer back,
 * and fails open — reporting why — when pawd gives no answer or the call throws.
 *
 * @module @paw/daemon/test/herdHooks
 */

import { describe, expect, it } from 'vitest';
import type { PawEventType } from '@paw/core';
import { createHerdHooks } from '../src/application/herdHooks.js';

/**
 * Dispatch fake: record every call, answer with `answer`.
 *
 * @param {unknown} answer - What pawd answers, or a thrower.
 * @returns {{ calls: Array<{ event: PawEventType; payload: Record<string, unknown> }>; dispatch: (event: PawEventType, payload: Record<string, unknown>) => Promise<unknown> }} Recorder.
 */
function recorder(answer: unknown) {
  const calls: Array<{ event: PawEventType; payload: Record<string, unknown> }> = [];
  return {
    calls,
    dispatch: async (event: PawEventType, payload: Record<string, unknown>): Promise<unknown> => {
      calls.push({ event, payload });
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
  };
}

const session = { sessionId: 'member-3' };

describe('createHerdHooks', () => {
  it('relays a pre-tool call and hands pawd answer to the SDK', async () => {
    const deny = { permissionDecision: 'deny', permissionDecisionReason: 'fix src/a.ts first' };
    const r = recorder(deny);
    const hooks = createHerdHooks(r.dispatch, () => undefined);
    expect(await hooks.onPreToolUse({ toolName: 'edit', toolArgs: { path: 'src/b.ts' } }, session)).toEqual(deny);
    expect(r.calls).toEqual([
      { event: 'tool.pre', payload: { sessionId: 'member-3', toolName: 'edit', toolArgs: { path: 'src/b.ts' } } },
    ]);
  });

  it('relays a finished tool call as a post-tool edit, and a failed one as failed', async () => {
    const r = recorder({ additionalContext: 'file too long' });
    const hooks = createHerdHooks(r.dispatch, () => undefined);
    const input = { toolName: 'edit', toolArgs: { path: 'src/a.ts' } };
    expect(await hooks.onPostToolUse(input, session)).toEqual({ additionalContext: 'file too long' });
    await hooks.onPostToolUseFailure(input, session);
    expect(r.calls.map((c) => [c.event, c.payload.failed])).toEqual([
      ['tool.post', false],
      ['tool.post', true],
    ]);
  });

  it('relays a submitted prompt', async () => {
    const r = recorder({ additionalContext: 'L1' });
    const hooks = createHerdHooks(r.dispatch, () => undefined);
    expect(await hooks.onUserPromptSubmitted({ prompt: 'go' }, session)).toEqual({ additionalContext: 'L1' });
    expect(r.calls[0]).toEqual({ event: 'prompt.submitted', payload: { sessionId: 'member-3', prompt: 'go' } });
  });

  it('fails open and says so when pawd gives no answer', async () => {
    const reasons: string[] = [];
    const hooks = createHerdHooks(recorder(null).dispatch, (reason) => reasons.push(reason));
    expect(await hooks.onPreToolUse({ toolName: 'edit', toolArgs: {} }, session)).toBeUndefined();
    expect(reasons).toEqual(['tool.pre: pawd gave no answer · allowed without enforcement']);
  });

  it('fails open and says so when the call throws', async () => {
    const reasons: string[] = [];
    const hooks = createHerdHooks(recorder(new Error('pipe closed')).dispatch, (reason) => reasons.push(reason));
    expect(await hooks.onPostToolUse({ toolName: 'edit', toolArgs: {} }, session)).toBeUndefined();
    expect(reasons).toEqual(['tool.post: Error: pipe closed · allowed without enforcement']);
  });
});
