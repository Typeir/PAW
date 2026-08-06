/**
 * PAW Copilot-Hooks Connector
 *
 * @fileoverview A {@link HostConnector} that bolts PAW onto GitHub Copilot's
 * hooks surface (the CLI/VS Code `hooks.json` stdin/stdout protocol) — through
 * translation, not through PAW's core knowing anything about Copilot. It maps a
 * hook payload to a canonical {@link PawEvent} and a canonical {@link PawResponse}
 * back to the hook output shape Copilot expects. This is the reference connector:
 * a new host (an Anthropic runtime, a Codex runtime) is a sibling of this file,
 * selected by `PawConfig.connector`, with PAW's loop untouched.
 *
 * @module @paw/connectors/copilotHooks
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { HostConnector, PawEvent, PawResponse } from '@paw/core';

/**
 * Coerce a value to a non-empty string, or null.
 *
 * @param {unknown} v - The value.
 * @returns {string | null} The string, or null.
 */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Parse a tool-args source that may be an object or a JSON string. Malformed
 * input yields null — a handled, expected case (the host sent non-JSON), not a
 * swallowed error: the caller treats null as "no arguments here".
 *
 * @param {unknown} src - The source value.
 * @returns {Record<string, unknown> | null} The parsed record, or null.
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
 * Extract the file paths a hook payload references, normalised to forward
 * slashes. Covers the `toolInput` object and the `toolArgs` string/object forms.
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
 * The first path that is an environment file, or null. Env files must never
 * reach the model context, so their presence is surfaced to the enforcement
 * decision.
 *
 * @param {string[]} paths - Candidate paths.
 * @returns {string | null} The matching path, or null.
 */
function envMatch(paths: string[]): string | null {
  const isEnv = /(?:^|\/)\.env(?:\.[A-Za-z0-9_.-]+)?$/;
  return paths.find((p) => isEnv.test(p)) ?? null;
}

/**
 * The session id from either casing.
 *
 * @param {Record<string, unknown>} raw - The hook payload.
 * @returns {string | null} The session id, or null.
 */
function sessionId(raw: Record<string, unknown>): string | null {
  return str(raw.session_id) ?? str(raw.sessionId);
}

/**
 * The tool name from either casing.
 *
 * @param {Record<string, unknown>} raw - The hook payload.
 * @returns {string} The tool name, or empty string.
 */
function toolName(raw: Record<string, unknown>): string {
  return str(raw.tool_name) ?? str(raw.toolName) ?? '';
}

/**
 * The Copilot-hooks connector.
 */
export const copilotHooksConnector: HostConnector = {
  name: 'copilot-hooks',

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
