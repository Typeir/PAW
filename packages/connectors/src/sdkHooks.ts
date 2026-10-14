/**
 * PAW SDK-Hooks Connector
 *
 * @fileoverview {@link HostConnector} for Copilot SDK session hooks, the hooks a
 * herd's sessions carry. The herd relays `{ sessionId, toolName, toolArgs,
 * failed, prompt }`; dispatch adds `hookEventName`. Output is the SDK hook
 * output shape. The SDK has no post-tool block, so a post-edit finding travels
 * as `additionalContext`.
 *
 * @module @paw/connectors/sdkHooks
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { HostConnector, PawEvent, PawEventType, PawResponse } from '@paw/core';
import { envMatch, extractCommands, extractPaths, sessionId, str, toolName } from './hookPayload.js';

/**
 * SDK hook name for each canonical event the herd relays.
 */
const SDK_EVENT_NAME: Record<PawEventType, string | null> = {
  'session.start': null,
  'prompt.submitted': 'onUserPromptSubmitted',
  'tool.pre': 'onPreToolUse',
  'tool.post': 'onPostToolUse',
  'session.end': null,
};

/**
 * SDK built-in tools that never write a file.
 */
const READ_ONLY_TOOLS: readonly string[] = ['view', 'grep'];

/**
 * SDK-hooks connector.
 */
export const sdkHooksConnector: HostConnector = {
  name: 'sdk-hooks',
  readOnlyTools: READ_ONLY_TOOLS,

  eventName(type: PawEventType): string | null {
    return SDK_EVENT_NAME[type];
  },

  toEvent(raw: unknown): PawEvent | null {
    if (typeof raw !== 'object' || raw === null) {
      return null;
    }
    const r = raw as Record<string, unknown>;
    const session = sessionId(r);
    switch (str(r.hookEventName)) {
      case 'onPreToolUse': {
        const paths = extractPaths(r);
        return {
          type: 'tool.pre',
          sessionId: session,
          toolName: toolName(r),
          targetPaths: paths,
          envMatch: envMatch(paths, extractCommands(r)),
        };
      }
      case 'onPostToolUse':
        return {
          type: 'tool.post',
          sessionId: session,
          toolName: toolName(r),
          editedPaths: extractPaths(r),
          failed: r.failed === true,
        };
      case 'onUserPromptSubmitted':
        return { type: 'prompt.submitted', sessionId: session, prompt: str(r.prompt) ?? '' };
      default:
        return null;
    }
  },

  fromResponse(response: PawResponse): unknown {
    switch (response.kind) {
      case 'deny':
        return { permissionDecision: 'deny', permissionDecisionReason: response.reason };
      case 'block':
        return { additionalContext: response.reason };
      case 'context':
        return { additionalContext: response.additionalContext };
      case 'allow':
        return response.additionalContext === undefined
          ? {}
          : { additionalContext: response.additionalContext };
      default:
        return {};
    }
  },
};
