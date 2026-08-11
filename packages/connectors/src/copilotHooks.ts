/**
 * PAW Copilot-Hooks Connector
 *
 * @fileoverview {@link HostConnector} adapts PAW to GitHub Copilot hooks
 * surface (CLI/VS Code `hooks.json` stdin/stdout protocol) by translation; core
 * stay unaware of Copilot. Map hook payload to canonical {@link PawEvent}, and
 * canonical {@link PawResponse} back to hook output shape Copilot expect.
 * Reference connector: new host (Anthropic runtime, Codex runtime) be sibling
 * file, selected by `PawConfig.connector`, with PAW loop untouched.
 *
 * @module @paw/connectors/copilotHooks
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { HostConnector, PawEvent, PawEventType, PawResponse } from '@paw/core';

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
 * Coerce value to non-empty string, or null.
 *
 * @param {unknown} v - Value.
 * @returns {string | null} The string, or null.
 */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Parse tool-args source, object or JSON string. Malformed input yield null;
 * caller treat null as "no arguments here".
 *
 * @param {unknown} src - Source value.
 * @returns {Record<string, unknown> | null} Parsed record, or null.
 */
function asArgs(src: unknown): Record<string, unknown> | null {
  if (typeof src === 'string') {
    try {
      return JSON.parse(src) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof src === 'object' && src !== null) {
    return src as Record<string, unknown>;
  }
  return null;
}

/**
 * Extract file paths hook payload reference, normalise to forward slashes.
 * Cover `toolInput` object and `toolArgs` string/object forms.
 *
 * @param {Record<string, unknown>} raw - The hook payload.
 * @returns {string[]} The referenced paths.
 */
function extractPaths(raw: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const source of [raw.toolInput, raw.tool_input, raw.toolArgs]) {
    const args = asArgs(source);
    if (!args) {
      continue;
    }
    for (const key of ['path', 'filePath', 'file_path']) {
      const value = args[key];
      if (typeof value === 'string') {
        paths.push(value.replace(/\\/g, '/'));
      }
    }
  }
  return paths;
}

/**
 * First path that be environment file, or null. Callers use the returned path
 * to make an enforcement decision.
 *
 * @param {string[]} paths - Candidate paths.
 * @returns {string | null} The matching path, or null.
 */
function envMatch(paths: string[]): string | null {
  const isEnv = /(?:^|\/)\.env(?:\.[A-Za-z0-9_.-]+)?$/;
  return paths.find((p) => isEnv.test(p)) ?? null;
}

/**
 * Session id from either casing.
 *
 * @param {Record<string, unknown>} raw - The hook payload.
 * @returns {string | null} The session id, or null.
 */
function sessionId(raw: Record<string, unknown>): string | null {
  return str(raw.session_id) ?? str(raw.sessionId);
}

/**
 * Tool name from either casing.
 *
 * @param {Record<string, unknown>} raw - The hook payload.
 * @returns {string} The tool name, or empty string.
 */
function toolName(raw: Record<string, unknown>): string {
  return str(raw.tool_name) ?? str(raw.toolName) ?? '';
}

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
          envMatch: envMatch(paths),
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

  fromResponse(response: PawResponse): unknown {
    switch (response.kind) {
      case 'deny':
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: response.reason,
          },
        };
      case 'allow':
        return response.additionalContext !== undefined
          ? {
              continue: true,
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
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
