/**
 * PAW Canonical Event Model
 *
 * @fileoverview Host-agnostic event stream PAW process, plus response it
 * return. Contract PAW ship. Host — Copilot SDK, Copilot CLI, VS Code extension,
 * Anthropic codex runtime — never pass own native semantics to PAW core;
 * connector maps host native event format onto one of these {@link PawEvent}s
 * and maps {@link PawResponse} back. PAW runs same loop for every host; only
 * connector at edge differ. PAW binds to host through config.
 *
 * @module @paw/core/domain/event
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Canonical event kinds as runtime list; boundary validate event string off wire
 * against it.
 */
export const PAW_EVENT_TYPES = [
  'session.start',
  'prompt.submitted',
  'tool.pre',
  'tool.post',
  'session.end',
] as const;

/**
 * Canonical event kinds. Hosts map own lifecycle names onto these.
 */
export type PawEventType = (typeof PAW_EVENT_TYPES)[number];

/**
 * Tool about to run — enforcement decision point.
 *
 * @interface ToolPreEvent
 * @property {'tool.pre'} type - Discriminant.
 * @property {string | null} sessionId - Host session id, or null.
 * @property {string} toolName - Canonical tool name.
 * @property {readonly string[]} targetPaths - Project-relative paths tool would touch.
 * @property {string | null} envMatch - Secret/`.env` path or command connector detect, or null.
 */
export interface ToolPreEvent {
  readonly type: 'tool.pre';
  readonly sessionId: string | null;
  readonly toolName: string;
  readonly targetPaths: readonly string[];
  readonly envMatch: string | null;
}

/**
 * Tool done — gate/record point.
 *
 * @interface ToolPostEvent
 * @property {'tool.post'} type - Discriminant.
 * @property {string | null} sessionId - Host session id, or null.
 * @property {string} toolName - Canonical tool name.
 * @property {readonly string[]} editedPaths - Paths tool changed.
 * @property {boolean} failed - Tool report failure or not.
 */
export interface ToolPostEvent {
  readonly type: 'tool.post';
  readonly sessionId: string | null;
  readonly toolName: string;
  readonly editedPaths: readonly string[];
  readonly failed: boolean;
}

/**
 * User submit prompt — L1 context injection point.
 *
 * @interface PromptSubmittedEvent
 * @property {'prompt.submitted'} type - Discriminant.
 * @property {string | null} sessionId - Host session id, or null.
 * @property {string} prompt - Submitted prompt text.
 */
export interface PromptSubmittedEvent {
  readonly type: 'prompt.submitted';
  readonly sessionId: string | null;
  readonly prompt: string;
}

/**
 * Session begin.
 *
 * @interface SessionStartEvent
 * @property {'session.start'} type - Discriminant.
 * @property {string | null} sessionId - Host session id, or null.
 * @property {string} source - How it start (host-specific label).
 */
export interface SessionStartEvent {
  readonly type: 'session.start';
  readonly sessionId: string | null;
  readonly source: string;
}

/**
 * Session end — final-gate point.
 *
 * @interface SessionEndEvent
 * @property {'session.end'} type - Discriminant.
 * @property {string | null} sessionId - Host session id, or null.
 * @property {string} reason - Why it end (host-specific label).
 * @property {boolean} nested - Nested/re-entrant end, must ignore.
 */
export interface SessionEndEvent {
  readonly type: 'session.end';
  readonly sessionId: string | null;
  readonly reason: string;
  readonly nested: boolean;
}

/**
 * Canonical event union. Connector produce exactly one these from host native
 * payload.
 */
export type PawEvent =
  | ToolPreEvent
  | ToolPostEvent
  | PromptSubmittedEvent
  | SessionStartEvent
  | SessionEndEvent;

/**
 * Canonical response PAW return for event. Connector map this to its host native
 * output shape.
 *
 * - `allow` — proceed; may carry hidden context for model.
 * - `deny` — veto tool (pre-tool block).
 * - `block` — stop post-tool or session-end from proceeding, with reason.
 * - `context` — inject context without blocking (L1 injection).
 * - `noop` — nothing to do.
 */
export type PawResponse =
  | { readonly kind: 'allow'; readonly additionalContext?: string }
  | { readonly kind: 'deny'; readonly reason: string }
  | { readonly kind: 'block'; readonly reason: string }
  | { readonly kind: 'context'; readonly additionalContext: string }
  | { readonly kind: 'noop' };
