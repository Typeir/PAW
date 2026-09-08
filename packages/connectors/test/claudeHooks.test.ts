/**
 * PAW Claude-Code-Hooks Connector Tests
 *
 * @fileoverview Test translation both way. Every event mapping including
 * `PostToolUseFailure` and `SessionEnd`, snake_case payload fields, shell
 * env detection, unknown-event and non-object null case, and every response
 * kind tagged with the firing event. Cover `claudeHooks.ts` to 100%.
 *
 * @module @paw/connectors/test/claudeHooks
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { claudeHooksConnector as c } from '../src/claudeHooks.js';

describe('claudeHooksConnector.eventName', () => {
  it('maps each canonical event to its Claude Code name', () => {
    expect(c.eventName('tool.pre')).toBe('PreToolUse');
    expect(c.eventName('tool.post')).toBe('PostToolUse');
    expect(c.eventName('prompt.submitted')).toBe('UserPromptSubmit');
    expect(c.eventName('session.start')).toBe('SessionStart');
    expect(c.eventName('session.end')).toBe('Stop');
  });
});

describe('claudeHooksConnector.toEvent', () => {
  it('returns null for a non-object payload', () => {
    expect(c.toEvent('nope')).toBeNull();
    expect(c.toEvent(null)).toBeNull();
  });

  it('returns null for an event PAW does not act on', () => {
    expect(c.toEvent({ hook_event_name: 'PreCompact' })).toBeNull();
  });

  it('maps PreToolUse from a snake_case payload', () => {
    expect(
      c.toEvent({
        hook_event_name: 'PreToolUse',
        session_id: 's1',
        tool_name: 'Edit',
        tool_input: { file_path: 'src\\a.ts' },
      }),
    ).toMatchObject({
      type: 'tool.pre',
      sessionId: 's1',
      toolName: 'Edit',
      targetPaths: ['src/a.ts'],
      envMatch: null,
    });
  });

  it('denies an env file reached by path or by shell command', () => {
    expect(
      c.toEvent({ hook_event_name: 'PreToolUse', tool_input: { file_path: '.env.local' } }),
    ).toMatchObject({ envMatch: '.env.local' });

    expect(
      c.toEvent({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'cat .env' },
      }),
    ).toMatchObject({ targetPaths: [], envMatch: '.env' });
  });

  it('maps a NotebookEdit path', () => {
    expect(
      c.toEvent({ hook_event_name: 'PreToolUse', tool_input: { notebook_path: 'nb.ipynb' } }),
    ).toMatchObject({ targetPaths: ['nb.ipynb'] });
  });

  it('maps PostToolUse as a success and PostToolUseFailure as a failure', () => {
    expect(
      c.toEvent({ hook_event_name: 'PostToolUse', tool_input: { file_path: 'src/b.ts' } }),
    ).toMatchObject({ type: 'tool.post', editedPaths: ['src/b.ts'], failed: false });

    expect(
      c.toEvent({ hook_event_name: 'PostToolUseFailure', tool_input: { file_path: 'src/b.ts' } }),
    ).toMatchObject({ type: 'tool.post', editedPaths: ['src/b.ts'], failed: true });
  });

  it('maps UserPromptSubmit, defaulting an absent prompt to empty', () => {
    expect(c.toEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' })).toMatchObject({
      type: 'prompt.submitted',
      prompt: 'hi',
    });
    expect(c.toEvent({ hook_event_name: 'UserPromptSubmit' })).toMatchObject({ prompt: '' });
  });

  it('maps SessionStart, keeping a given source and defaulting an absent one', () => {
    expect(c.toEvent({ hook_event_name: 'SessionStart', source: 'resume' })).toMatchObject({
      type: 'session.start',
      source: 'resume',
    });
    expect(c.toEvent({ hook_event_name: 'SessionStart' })).toMatchObject({ source: 'unknown' });
  });

  it('maps Stop, flagging a nested end and defaulting an absent reason', () => {
    expect(
      c.toEvent({ hookEventName: 'Stop', reason: 'done', stop_hook_active: true }),
    ).toMatchObject({ type: 'session.end', reason: 'done', nested: true });
    expect(c.toEvent({ hookEventName: 'Stop' })).toMatchObject({
      type: 'session.end',
      reason: 'stop',
      nested: false,
    });
  });

  it('maps SessionEnd as a never-nested session end', () => {
    expect(c.toEvent({ hook_event_name: 'SessionEnd', reason: 'logout' })).toMatchObject({
      type: 'session.end',
      reason: 'logout',
      nested: false,
    });
    expect(c.toEvent({ hook_event_name: 'SessionEnd' })).toMatchObject({ reason: 'other' });
  });
});

describe('claudeHooksConnector.fromResponse', () => {
  it('renders a deny as a permission denial on the firing event', () => {
    expect(c.fromResponse({ kind: 'deny', reason: 'blocked' }, 'tool.pre')).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'blocked',
      },
    });
  });

  it('renders a bare allow as no decision', () => {
    expect(c.fromResponse({ kind: 'allow' }, 'tool.pre')).toEqual({});
  });

  it('renders an allow with context, tagged with the firing event', () => {
    expect(c.fromResponse({ kind: 'allow', additionalContext: 'note' }, 'tool.pre')).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'note' },
    });
  });

  it('injects L1 context on the prompt event', () => {
    expect(c.fromResponse({ kind: 'context', additionalContext: 'L1' }, 'prompt.submitted')).toEqual(
      { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'L1' } },
    );
  });

  it('renders a block as context on the post-tool event', () => {
    expect(c.fromResponse({ kind: 'block', reason: 'gate failed' }, 'tool.post')).toEqual({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'gate failed' },
    });
  });

  it('renders a noop as no decision', () => {
    expect(c.fromResponse({ kind: 'noop' }, 'session.end')).toEqual({});
  });
});
