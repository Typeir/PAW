/**
 * PAW Copilot-Hooks Connector
 *
 * @fileoverview {@link HostConnector} adapting PAW to the Copilot hooks surface
 * by translation; core stay unaware of Copilot. Map hook payload to canonical
 * {@link PawEvent}, and canonical {@link PawResponse} back to the hook output
 * shape.
 *
 * The event names here are unverified against a live Copilot session — GitHub
 * documents camelCase (`preToolUse`), this maps PascalCase. Dump a real hook
 * payload before trusting either. See `.ignore/tasks/CLAUDE-CODE-HOISTING.md` §2.
 *
 * @module @paw/connectors/copilotHooks
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
 * Host native name for each canonical event. {@link copilotHooksConnector.toEvent}
 * uses this map to translate a canonical type to its hook name.
 */
const COPILOT_EVENT_NAME: Record<PawEventType, string> = {
  'session.start': 'SessionStart',
  'prompt.submitted': 'UserPromptSubmit',
  'tool.pre': 'PreToolUse',
  'tool.post': 'PostToolUse',
  'session.end': 'Stop',
};

/**
 * Copilot-hooks connector.
 */
export const copilotHooksConnector: HostConnector = {
  name: 'copilot-hooks',

  eventName(type: PawEventType): string | null {
    return COPILOT_EVENT_NAME[type];
  },

  toEvent(raw: unknown): PawEvent | null {
    if (typeof raw !== 'object' || raw === null) {
      return null;
    }
    const r = raw as Record<string, unknown>;
    const event = str(r.hookEventName) ?? str(r.hook_event_name);
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
        return {
          type: 'tool.post',
          sessionId: session,
          toolName: toolName(r),
          editedPaths: extractPaths(r),
          failed: r.toolFailed === true,
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
      default:
        return null;
    }
  },

  fromResponse(response: PawResponse, type: PawEventType): unknown {
    const hookEventName = COPILOT_EVENT_NAME[type];
    switch (response.kind) {
      case 'deny':
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName,
            permissionDecision: 'deny',
            permissionDecisionReason: response.reason,
          },
        };
      case 'allow':
        return response.additionalContext !== undefined
          ? {
              continue: true,
              hookSpecificOutput: {
                hookEventName,
                additionalContext: response.additionalContext,
              },
            }
          : { continue: true };
      case 'context':
        return { continue: true, systemMessage: response.additionalContext };
      case 'block':
        return { continue: true, decision: 'block', reason: response.reason };
      default:
        return { continue: true };
    }
  },
};
