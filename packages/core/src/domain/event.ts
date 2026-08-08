/**
 * PAW Canonical Event Model
 *
 * @fileoverview The host-agnostic event stream PAW reasons over, and the
 * response it returns. This is the contract PAW ships. A host — the Copilot SDK,
 * the Copilot CLI, a VS Code extension, or tomorrow an Anthropic or Codex
 * runtime — never speaks its own semantics to PAW's core; a connector translates
 * the host's native surface into one of these {@link PawEvent}s and translates a
 * {@link PawResponse} back. PAW's loop is identical for every host; only the
 * connector at the edge differs. That is what lets PAW sit anywhere and bolt onto
 * anything through configuration rather than through hardcoded names and paths.
 *
 * @module @paw/core/domain/event
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * The canonical event kinds, as a runtime list so a boundary can validate an
 * event string off the wire without a second hand-kept copy.
 */
export const PAW_EVENT_TYPES = [
  'session.start',
  'prompt.submitted',
  'tool.pre',
  'tool.post',
  'session.end',
] as const;

/**
 * The canonical event kinds. Hosts map their own lifecycle names onto these.
 */
export type PawEventType = (typeof PAW_EVENT_TYPES)[number];

/**
 * A tool is about to run — the enforcement decision point.
 *
 * @interface ToolPreEvent
 * @property {'tool.pre'} type - Discriminant.
 * @property {string | null} sessionId - Host session id, or null.
 * @property {string} toolName - Canonical tool name.
 * @property {readonly string[]} targetPaths - Project-relative paths the tool would touch.
 * @property {string | null} envMatch - A secret/`.env` path or command the connector detected, or null.
 */
export interface ToolPreEvent {
  readonly type: 'tool.pre';
  readonly sessionId: string | null;
  readonly toolName: string;
  readonly targetPaths: readonly string[];
  readonly envMatch: string | null;
}

/**
 * A tool has finished — the gate/record point.
 *
 * @interface ToolPostEvent
 * @property {'tool.post'} type - Discriminant.
 * @property {string | null} sessionId - Host session id, or null.
 * @property {string} toolName - Canonical tool name.
 * @property {readonly string[]} editedPaths - Paths the tool changed.
 * @property {boolean} failed - Whether the tool reported failure.
 */
export interface ToolPostEvent {
  readonly type: 'tool.post';
  readonly sessionId: string | null;
  readonly toolName: string;
  readonly editedPaths: readonly string[];
  readonly failed: boolean;
}

/**
 * The user submitted a prompt — the L1 context injection point.
 *
 * @interface PromptSubmittedEvent
 * @property {'prompt.submitted'} type - Discriminant.
 * @property {string | null} sessionId - Host session id, or null.
 * @property {string} prompt - The submitted prompt text.
 */
export interface PromptSubmittedEvent {
  readonly type: 'prompt.submitted';
  readonly sessionId: string | null;
  readonly prompt: string;
}

/**
 * A session began.
 *
 * @interface SessionStartEvent
 * @property {'session.start'} type - Discriminant.
 * @property {string | null} sessionId - Host session id, or null.
 * @property {string} source - How it started (host-specific label).
 */
export interface SessionStartEvent {
  readonly type: 'session.start';
  readonly sessionId: string | null;
  readonly source: string;
}

/**
 * A session is ending — the final-gate point.
 *
 * @interface SessionEndEvent
 * @property {'session.end'} type - Discriminant.
 * @property {string | null} sessionId - Host session id, or null.
 * @property {string} reason - Why it ended (host-specific label).
 * @property {boolean} nested - Whether this is a nested/re-entrant end that must be ignored.
 */
export interface SessionEndEvent {
  readonly type: 'session.end';
  readonly sessionId: string | null;
  readonly reason: string;
  readonly nested: boolean;
}

/**
 * The canonical event union. A connector produces exactly one of these from a
 * host's native payload.
 */
export type PawEvent =
  | ToolPreEvent
  | ToolPostEvent
  | PromptSubmittedEvent
  | SessionStartEvent
  | SessionEndEvent;

/**
 * The canonical response PAW returns for an event. A connector maps this to its
 * host's native output shape.
 *
 * - `allow` — proceed; may carry hidden context for the model.
 * - `deny` — veto a tool (the pre-tool block).
 * - `block` — stop a post-tool or session-end from proceeding, with a reason.
 * - `context` — inject context without blocking (the L1 injection).
 * - `noop` — nothing to do.
 */
export type PawResponse =
  | { readonly kind: 'allow'; readonly additionalContext?: string }
  | { readonly kind: 'deny'; readonly reason: string }
  | { readonly kind: 'block'; readonly reason: string }
  | { readonly kind: 'context'; readonly additionalContext: string }
  | { readonly kind: 'noop' };
