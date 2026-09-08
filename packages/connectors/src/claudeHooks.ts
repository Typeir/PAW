/**
 * PAW Claude-Code-Hooks Connector
 *
 * @fileoverview {@link HostConnector} adapting PAW to the Claude Code hooks
 * surface (`.claude/settings.json` stdin/stdout protocol) by translation; core
 * stay unaware of Claude Code. Map hook payload to canonical {@link PawEvent},
 * and canonical {@link PawResponse} back to the hook output shape.
 *
 * Claude Code carries a tool failure as its own event, `PostToolUseFailure`,
 * and separates `Stop` (turn ended) from `SessionEnd` (session over); both
 * become `session.end`, told apart by `reason`.
 *
 * This connector renders decisions only. Denying a tool and refusing a stop are
 * exit codes, owned by the CLI shell that writes this output.
 *
 * @module @paw/connectors/claudeHooks
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { HostConnector, PawEvent, PawEventType, PawResponse } from '@paw/core';
import {
  envMatch,
  extractCommands,
  extractPaths,
  sessionId,
  str,
  toolName,
} from './hookPayload.js';

/**
 * Host native name for each canonical event. `session.end` maps to `Stop`, the
 * turn boundary, because that is where a final gate can still change the turn.
 */
const CLAUDE_EVENT_NAME: Record<PawEventType, string> = {
  'session.start': 'SessionStart',
  'prompt.submitted': 'UserPromptSubmit',
  'tool.pre': 'PreToolUse',
  'tool.post': 'PostToolUse',
  'session.end': 'Stop',
};

/**
 * Output that carries a decision under the firing event's name.
 *
 * @param {string} hookEventName - Host name of the event that fired.
 * @param {Record<string, unknown>} fields - Decision fields for that event.
 * @returns {Record<string, unknown>} Hook output object.
 */
function tagged(
  hookEventName: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return { hookSpecificOutput: { hookEventName, ...fields } };
}

/**
 * Claude-Code-hooks connector.
 */
export const claudeHooksConnector: HostConnector = {
  name: 'claude-hooks',

  eventName(type: PawEventType): string | null {
    return CLAUDE_EVENT_NAME[type];
  },

  toEvent(raw: unknown): PawEvent | null {
    if (typeof raw !== 'object' || raw === null) {
      return null;
    }
    const r = raw as Record<string, unknown>;
    const event = str(r.hook_event_name) ?? str(r.hookEventName);
    const session = sessionId(r);
    switch (event) {
      case 'PreToolUse': {
        const paths = extractPaths(r);
        return {
          type: 'tool.pre',
          sessionId: session,
          toolName: toolName(r),
          targetPaths: paths,
          envMatch: envMatch(paths, extractCommands(r)),
        };
      }
      case 'PostToolUse':
      case 'PostToolUseFailure':
        return {
          type: 'tool.post',
          sessionId: session,
          toolName: toolName(r),
          editedPaths: extractPaths(r),
          failed: event === 'PostToolUseFailure',
        };
      case 'UserPromptSubmit':
        return {
          type: 'prompt.submitted',
          sessionId: session,
          prompt: str(r.prompt) ?? '',
        };
      case 'SessionStart':
        return {
          type: 'session.start',
          sessionId: session,
          source: str(r.source) ?? 'unknown',
        };
      case 'Stop':
        return {
          type: 'session.end',
          sessionId: session,
          reason: str(r.reason) ?? 'stop',
          nested: r.stop_hook_active === true,
        };
      case 'SessionEnd':
        return {
          type: 'session.end',
          sessionId: session,
          reason: str(r.reason) ?? 'other',
          nested: false,
        };
      default:
        return null;
    }
  },

  fromResponse(response: PawResponse, type: PawEventType): unknown {
    const hookEventName = CLAUDE_EVENT_NAME[type];
    switch (response.kind) {
      case 'deny':
        return tagged(hookEventName, {
          permissionDecision: 'deny',
          permissionDecisionReason: response.reason,
        });
      case 'allow':
        return response.additionalContext === undefined
          ? {}
          : tagged(hookEventName, { additionalContext: response.additionalContext });
      case 'context':
        return tagged(hookEventName, { additionalContext: response.additionalContext });
      case 'block':
        return tagged(hookEventName, { additionalContext: response.reason });
      default:
        return {};
    }
  },
};
