/**
 * PAW Hook Bridge
 *
 * @fileoverview `paw hook --<host> <event>` — the bridge from a host's hook
 * process to PAW's loop. It reads the host's native payload on stdin, selects the
 * host's connector, translates the payload into a canonical event, runs it
 * through {@link handleEvent}, and writes the connector's native output back. The
 * per-event I/O is the connector's (the proven, ported translation); this module
 * only routes host + event to it. The event argument is authoritative — it is
 * what `hooks.json` wired — so it stamps the host event name before translation.
 *
 * @module @paw/cli/hook
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  handleEvent,
  type HandleDeps,
  type HostConnector,
  type PawEventType,
} from '@paw/core';
import { copilotHooksConnector } from '@paw/connectors';

/**
 * The stdin/stdout seam, injected so the router is testable without a process.
 *
 * @interface HookIo
 * @property {() => Promise<string>} readStdin - Read the whole host payload.
 * @property {(text: string) => void} writeStdout - Emit the connector's output.
 */
export interface HookIo {
  readStdin(): Promise<string>;
  writeStdout(text: string): void;
}

/**
 * Read-only tools never blocked by violations, ported from the legacy
 * `preToolUse` hook. The agent needs these to diagnose and fix.
 */
export const EXEMPT_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'view_image',
  'grep_search',
  'file_search',
  'semantic_search',
  'list_dir',
  'get_errors',
  'get_terminal_output',
  'memory',
  'manage_todo_list',
  'vscode_askQuestions',
  'tool_search_tool_regex',
  'fetch_webpage',
  'task_complete',
]);

/**
 * Canonical event → the host event name a connector keys its translation on.
 */
const EVENT_HOOK_NAME: Record<PawEventType, string> = {
  'session.start': 'SessionStart',
  'prompt.submitted': 'UserPromptSubmit',
  'tool.pre': 'PreToolUse',
  'tool.post': 'PostToolUse',
  'session.end': 'Stop',
};

/**
 * The host connectors `paw hook --<host>` can select.
 */
export const HOST_CONNECTORS: Record<string, HostConnector> = {
  copilot: copilotHooksConnector,
};

/**
 * Whether a string names a canonical event.
 *
 * @param {string} x - The candidate event name.
 * @returns {boolean} True when it is a {@link PawEventType}.
 */
function isEventType(x: string): x is PawEventType {
  return Object.prototype.hasOwnProperty.call(EVENT_HOOK_NAME, x);
}

/**
 * Route one host hook invocation through PAW's loop.
 *
 * @param {string} host - The host key (e.g. `copilot`).
 * @param {string} event - The canonical event the command names (e.g. `tool.pre`).
 * @param {HookIo} io - The stdin/stdout seam.
 * @param {HandleDeps} deps - The loop dependencies (store, gates, exempt, ignore).
 * @param {Record<string, HostConnector>} [connectors] - The host registry; defaults to {@link HOST_CONNECTORS}.
 * @returns {Promise<number>} The process exit code — always 0; the decision rides in the JSON.
 */
export async function runHook(
  host: string,
  event: string,
  io: HookIo,
  deps: HandleDeps,
  connectors: Record<string, HostConnector> = HOST_CONNECTORS,
): Promise<number> {
  const connector = connectors[host];
  if (!connector) {
    throw new Error(`unknown hook host "${host}"`);
  }
  if (!isEventType(event)) {
    throw new Error(`unknown hook event "${event}"`);
  }
  const raw = JSON.parse(await io.readStdin()) as Record<string, unknown>;
  const pawEvent = connector.toEvent({ ...raw, hookEventName: EVENT_HOOK_NAME[event] });
  if (!pawEvent) {
    io.writeStdout(JSON.stringify({ continue: true }));
    return 0;
  }
  const response = await handleEvent(pawEvent, deps);
  io.writeStdout(JSON.stringify(connector.fromResponse(response)));
  return 0;
}
