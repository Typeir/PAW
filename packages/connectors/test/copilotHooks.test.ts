/**
 * PAW Copilot-Hooks Connector Tests
 *
 * @fileoverview Covers translation both ways — every event mapping, path
 * extraction from object and JSON-string args, malformed args, env detection,
 * both id casings, the unknown-event and non-object null cases, and every
 * response kind — so `copilotHooks.ts` reaches 100%.
 *
 * @module @paw/connectors/test/copilotHooks
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { copilotHooksConnector as c } from '../src/copilotHooks.js';

describe('copilotHooksConnector.toEvent', () => {
  it('returns null for a non-object payload', () => {
    expect(c.toEvent('nope')).toBeNull();
  });

  it('returns null for an unrecognised hook event', () => {
    expect(c.toEvent({ hookEventName: 'PreCompact' })).toBeNull();
  });

  it('maps PreToolUse with object args and detects an env file', () => {
    const e = c.toEvent({
      hookEventName: 'PreToolUse',
      session_id: 's1',
      tool_name: 'edit',
      toolInput: { path: 'src\\a.ts' },
    });
    expect(e).toMatchObject({
      type: 'tool.pre',
      sessionId: 's1',
      toolName: 'edit',
      targetPaths: ['src/a.ts'],
      envMatch: null,
    });

    const env = c.toEvent({
      hookEventName: 'PreToolUse',
      toolArgs: JSON.stringify({ filePath: '.env.local' }),
    });
    expect(env).toMatchObject({ envMatch: '.env.local' });
  });

  it('tolerates malformed JSON args as no paths', () => {
    const e = c.toEvent({ hookEventName: 'PreToolUse', toolArgs: 'not json', sessionId: 's2' });
    expect(e).toMatchObject({ type: 'tool.pre', sessionId: 's2', targetPaths: [] });
  });

  it('maps PostToolUse with a failure flag', () => {
    const e = c.toEvent({
      hookEventName: 'PostToolUse',
      tool_input: { file_path: 'src/b.ts' },
      toolFailed: true,
    });
    expect(e).toMatchObject({ type: 'tool.post', editedPaths: ['src/b.ts'], failed: true });
  });

  it('maps UserPromptSubmit, defaulting an absent prompt to empty', () => {
    expect(c.toEvent({ hookEventName: 'UserPromptSubmit', prompt: 'hi' })).toMatchObject({
      type: 'prompt.submitted',
      prompt: 'hi',
    });
    expect(c.toEvent({ hookEventName: 'UserPromptSubmit' })).toMatchObject({
      type: 'prompt.submitted',
      prompt: '',
    });
  });

  it('reads a camelCase tool name', () => {
    expect(
      c.toEvent({ hookEventName: 'PreToolUse', toolName: 'grep' }),
    ).toMatchObject({ type: 'tool.pre', toolName: 'grep' });
  });

  it('maps SessionStart, keeping a given source and defaulting an absent one', () => {
    expect(c.toEvent({ hookEventName: 'SessionStart', source: 'resume' })).toMatchObject({
      type: 'session.start',
      source: 'resume',
    });
    expect(c.toEvent({ hookEventName: 'SessionStart' })).toMatchObject({
      type: 'session.start',
      source: 'unknown',
    });
  });

  it('maps Stop, flagging nested ends and defaulting an absent reason', () => {
    expect(
      c.toEvent({ hook_event_name: 'Stop', reason: 'done', stop_hook_active: true }),
    ).toMatchObject({ type: 'session.end', reason: 'done', nested: true });
    expect(c.toEvent({ hook_event_name: 'Stop' })).toMatchObject({
      type: 'session.end',
      reason: 'stop',
      nested: false,
    });
  });
});

describe('copilotHooksConnector.fromResponse', () => {
  it('renders a deny as a PreToolUse permission denial', () => {
    expect(c.fromResponse({ kind: 'deny', reason: 'blocked' })).toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'blocked',
      },
    });
  });

  it('renders a bare allow as continue', () => {
    expect(c.fromResponse({ kind: 'allow' })).toEqual({ continue: true });
  });

  it('renders an allow with context via additionalContext', () => {
    expect(c.fromResponse({ kind: 'allow', additionalContext: 'note' })).toEqual({
      continue: true,
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'note' },
    });
  });

  it('renders context as a system message', () => {
    expect(c.fromResponse({ kind: 'context', additionalContext: 'L1' })).toEqual({
      continue: true,
      systemMessage: 'L1',
    });
  });

  it('renders a block with a decision and reason', () => {
    expect(c.fromResponse({ kind: 'block', reason: 'gate' })).toEqual({
      continue: true,
      decision: 'block',
      reason: 'gate',
    });
  });

  it('renders a noop as continue', () => {
    expect(c.fromResponse({ kind: 'noop' })).toEqual({ continue: true });
  });
});
