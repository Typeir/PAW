/**
 * PAW Canonical Event Map
 *
 * @fileoverview Maps PAW canonical event names to surface-specific event names
 * for the VS Code Extension, Copilot CLI, and Copilot SDK surfaces.
 *
 * @module .github/PAW/adapters/event-map
 * @author Typeir
 * @version 1.0.0
 * @since 4.0.0
 */

import { PawEvent } from './types';

/**
 * VS Code Extension event names (PascalCase).
 *
 * @type {Record<PawEvent, string | null>}
 */
export const EXTENSION_EVENT_MAP: Record<PawEvent, string | null> = {
  [PawEvent.SessionStart]: 'SessionStart',
  [PawEvent.PromptSubmitted]: 'UserPromptSubmit',
  [PawEvent.ToolPre]: 'PreToolUse',
  [PawEvent.ToolPost]: 'PostToolUse',
  [PawEvent.SessionEnd]: 'Stop',
  [PawEvent.SubagentStart]: 'SubagentStart',
  [PawEvent.SubagentStop]: 'SubagentStop',
  [PawEvent.ContextCompact]: 'PreCompact',
  [PawEvent.Error]: null,
};

/**
 * Copilot CLI event names (camelCase).
 *
 * @type {Record<PawEvent, string | null>}
 */
export const CLI_EVENT_MAP: Record<PawEvent, string | null> = {
  [PawEvent.SessionStart]: null,
  [PawEvent.PromptSubmitted]: 'userPromptSubmitted',
  [PawEvent.ToolPre]: 'preToolUse',
  [PawEvent.ToolPost]: 'postToolUse',
  [PawEvent.SessionEnd]: 'sessionEnd',
  [PawEvent.SubagentStart]: null,
  [PawEvent.SubagentStop]: null,
  [PawEvent.ContextCompact]: null,
  [PawEvent.Error]: null,
};

/**
 * Copilot SDK callback names (camelCase with "on" prefix).
 *
 * @type {Record<PawEvent, string | null>}
 */
export const SDK_EVENT_MAP: Record<PawEvent, string | null> = {
  [PawEvent.SessionStart]: 'onSessionStart',
  [PawEvent.PromptSubmitted]: 'onUserPromptSubmitted',
  [PawEvent.ToolPre]: 'onPreToolUse',
  [PawEvent.ToolPost]: 'onPostToolUse',
  [PawEvent.SessionEnd]: 'onSessionEnd',
  [PawEvent.SubagentStart]: null,
  [PawEvent.SubagentStop]: null,
  [PawEvent.ContextCompact]: null,
  [PawEvent.Error]: 'onErrorOccurred',
};

/**
 * Look up the surface-specific event name for a PAW canonical event.
 *
 * @param event - PAW canonical event
 * @param map - Surface event map to query
 * @returns Surface-specific event name, or null if the surface doesn't support this event
 */
export function resolveEventName(
  event: PawEvent,
  map: Record<PawEvent, string | null>,
): string | null {
  return map[event] ?? null;
}

/**
 * Check whether a surface supports a given PAW canonical event.
 *
 * @param event - PAW canonical event
 * @param map - Surface event map to query
 * @returns True if the surface has a mapping for this event
 */
export function isEventSupported(
  event: PawEvent,
  map: Record<PawEvent, string | null>,
): boolean {
  return map[event] !== null;
}
