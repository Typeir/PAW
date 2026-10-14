/**
 * SDK-hooks connector tests
 *
 * @fileoverview Pin translation between Copilot SDK session hooks and PAW's
 * canonical events: tool calls in, prompt submitted, failed tool runs, and every
 * response kind back out to the SDK hook output shape.
 *
 * @module @paw/connectors/test/sdkHooks
 */

import { describe, expect, it } from 'vitest';
import { sdkHooksConnector as c } from '../src/sdkHooks.js';

describe('sdkHooksConnector.readOnlyTools', () => {
  it('declares the SDK built-ins that only read', () => {
    expect(c.readOnlyTools).toEqual(['view', 'grep']);
  });
});

describe('sdkHooksConnector.eventName', () => {
  it('maps tool and prompt events to the SDK hook names', () => {
    expect(c.eventName('tool.pre')).toBe('onPreToolUse');
    expect(c.eventName('tool.post')).toBe('onPostToolUse');
    expect(c.eventName('prompt.submitted')).toBe('onUserPromptSubmitted');
  });

  it('names no session event, which the herd does not relay', () => {
    expect(c.eventName('session.start')).toBeNull();
    expect(c.eventName('session.end')).toBeNull();
  });
});

describe('sdkHooksConnector.toEvent', () => {
  it('reads a pre-tool call: tool, target path, session', () => {
    expect(
      c.toEvent({
        hookEventName: 'onPreToolUse',
        sessionId: 'm1',
        toolName: 'edit',
        toolArgs: { path: 'src/a.ts' },
      }),
    ).toEqual({
      type: 'tool.pre',
      sessionId: 'm1',
      toolName: 'edit',
      targetPaths: ['src/a.ts'],
      envMatch: null,
    });
  });

  it('reads tool arguments the runtime sends as a JSON string', () => {
    const event = c.toEvent({
      hookEventName: 'onPreToolUse',
      sessionId: 'm1',
      toolName: 'view',
      toolArgs: JSON.stringify({ path: 'C:\\repo\\.env' }),
    });
    expect(event).toMatchObject({ targetPaths: ['C:/repo/.env'], envMatch: 'C:/repo/.env' });
  });

  it('spots a provider key file named in a shell command', () => {
    const event = c.toEvent({
      hookEventName: 'onPreToolUse',
      sessionId: 'm1',
      toolName: 'powershell',
      toolArgs: { command: 'Get-Content .paw/deepseek.provider.env' },
    });
    expect(event).toMatchObject({ type: 'tool.pre', envMatch: '.paw/deepseek.provider.env' });
  });

  it('reads a post-tool call as an edit, failed or not', () => {
    const base = { hookEventName: 'onPostToolUse', sessionId: 'm1', toolName: 'edit', toolArgs: { path: 'src/a.ts' } };
    expect(c.toEvent(base)).toEqual({
      type: 'tool.post',
      sessionId: 'm1',
      toolName: 'edit',
      editedPaths: ['src/a.ts'],
      failed: false,
    });
    expect(c.toEvent({ ...base, failed: true })).toMatchObject({ failed: true });
  });

  it('reads a submitted prompt, empty when absent', () => {
    expect(c.toEvent({ hookEventName: 'onUserPromptSubmitted', sessionId: 'm1', prompt: 'go' })).toEqual({
      type: 'prompt.submitted',
      sessionId: 'm1',
      prompt: 'go',
    });
    expect(c.toEvent({ hookEventName: 'onUserPromptSubmitted' })).toEqual({
      type: 'prompt.submitted',
      sessionId: null,
      prompt: '',
    });
  });

  it('places nothing for an unknown hook or a non-object payload', () => {
    expect(c.toEvent({ hookEventName: 'onSessionEnd' })).toBeNull();
    expect(c.toEvent(null)).toBeNull();
    expect(c.toEvent('x')).toBeNull();
  });
});

describe('sdkHooksConnector.fromResponse', () => {
  it('turns a deny into an SDK permission decision with the reason', () => {
    expect(c.fromResponse({ kind: 'deny', reason: 'fix src/a.ts first' }, 'tool.pre')).toEqual({
      permissionDecision: 'deny',
      permissionDecisionReason: 'fix src/a.ts first',
    });
  });

  it('carries a nudge, a post-edit finding, and prompt context as additionalContext', () => {
    expect(c.fromResponse({ kind: 'allow', additionalContext: 'add a test' }, 'tool.pre')).toEqual({
      additionalContext: 'add a test',
    });
    expect(c.fromResponse({ kind: 'block', reason: 'file too long' }, 'tool.post')).toEqual({
      additionalContext: 'file too long',
    });
    expect(c.fromResponse({ kind: 'context', additionalContext: 'L1' }, 'prompt.submitted')).toEqual({
      additionalContext: 'L1',
    });
  });

  it('returns an empty output for a plain allow or a noop', () => {
    expect(c.fromResponse({ kind: 'allow' }, 'tool.pre')).toEqual({});
    expect(c.fromResponse({ kind: 'noop' }, 'tool.post')).toEqual({});
  });
});
