/**
 * PAW Hook Runtime
 *
 * @fileoverview Shared I/O protocol for Copilot hook TypeScript entrypoints.
 * All PAW hooks import from this module for reading stdin, writing stdout,
 * resolving file paths, and detecting re-entry.
 *
 * Output contract aligned to VS Code chatHooks API (v6):
 *   - continue / stopReason — agent continuation control
 *   - systemMessage — non-blocking informational message (visible to agent)
 *   - permissionDecision / permissionDecisionReason — PreToolUse top-level deny/allow
 *   - Exit code 0 = success, 2 = blocking error, other = non-blocking warning
 *
 * PreToolUse is the only hook that can deny tool execution. Its output format is:
 *   { permissionDecision: "deny", permissionDecisionReason: "..." }
 * PostToolUse can only observe and emit informational messages.
 *
 * @module .github/PAW/hook-runtime
 * @author PAW
 * @version 2.0.0
 * @since 3.0.0
 */

import { readFileSync } from 'node:fs';

/**
 * Generic dictionary type for hook payload objects.
 */
type HookRecord = Record<string, unknown>;

/**
 * Hook output shape accepted by VS Code chatHooks.
 *
 * Common fields (all hooks):
 *   continue, stopReason, systemMessage
 *
 * PreToolUse uses hookSpecificOutput.permissionDecision to deny/allow/ask.
 * PostToolUse uses top-level decision:'block' to halt further processing.
 * Stop/SubagentStop use hookSpecificOutput.decision:'block' to prevent stopping.
 *
 * @see https://code.visualstudio.com/docs/copilot/customization/hooks
 *
 * @interface HookResult
 * @property {boolean} continue - Must be true to allow the agent to continue
 * @property {string} [stopReason] - Reason string when stopping the agent
 * @property {string} [systemMessage] - Non-blocking informational message shown to the agent
 * @property {string} [decision] - PostToolUse/SubagentStop: 'block' to halt processing
 * @property {string} [reason] - Reason for blocking decision
 * @property {object} [hookSpecificOutput] - Event-specific payload
 */
export interface HookResult {
  continue: boolean;
  stopReason?: string;
  systemMessage?: string;
  /** PostToolUse / SubagentStop: block further processing */
  decision?: 'block';
  /** Reason shown to agent when decision is 'block' */
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: string;
    /** PreToolUse: deny, allow, or ask for user confirmation */
    permissionDecision?: 'allow' | 'ask' | 'deny';
    /** PreToolUse: reason shown to agent when denying */
    permissionDecisionReason?: string;
    /** PreToolUse: modified tool input (optional) */
    updatedInput?: Record<string, unknown>;
    /** Extra context injected into the conversation */
    additionalContext?: string;
    /** Stop/SubagentStop: block the agent from stopping */
    decision?: 'block';
    /** Stop/SubagentStop: reason for blocking stop */
    reason?: string;
  };
}

/**
 * Read JSON hook payload from stdin synchronously.
 * Uses readFileSync(fd 0) which reads all buffered stdin data in one call.
 * VS Code chatHooks writes stdin before the process begins executing, so
 * data is always available in the OS pipe buffer — no race with tsx startup.
 *
 * @returns Parsed payload object, or empty object on failure
 */
export function readHookInput(): HookRecord {
  try {
    const data = readFileSync(0, 'utf-8');
    return JSON.parse(data) as HookRecord;
  } catch {
    return {};
  }
}

/**
 * Emit hook result as single-line JSON to stdout.
 *
 * @param result - Result object to serialize
 */
export function writeHookOutput(result: HookResult): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

/**
 * Emit a blocking hook result and exit with code 2.
 * Exit code 2 signals a blocking error to VS Code — stop processing and
 * show error to model. Stderr is shown to the model as context.
 *
 * @param result - Result object to serialize
 */
export function writeBlockingOutput(result: HookResult): void {
  writeHookOutput(result);
  process.exit(2);
}

/**
 * Emit a PreToolUse denial via hookSpecificOutput.permissionDecision.
 * Outputs the correct VS Code format and exits with code 0 (not 2) because
 * the denial is expressed through JSON, not through exit code.
 *
 * @see https://code.visualstudio.com/docs/copilot/customization/hooks#_pretooluse-output
 * @param reason - Human-readable denial reason shown to the agent
 */
export function writeDenyOutput(reason: string): void {
  const result: HookResult = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

/**
 * Extract the edited file path from hook input.
 * Handles multiple payload structures from different tool sources.
 *
 * @param hookInput - Hook payload
 * @returns Resolved file path if present
 */
export function resolveEditedFilePath(
  hookInput: HookRecord,
): string | undefined {
  const candidates: string[] = [];
  const input = hookInput as {
    filePath?: unknown;
    toolInput?: { path?: unknown; filePath?: unknown; file_path?: unknown };
    tool_input?: unknown;
    toolArgs?: unknown;
  };

  if (typeof input.filePath === 'string') {
    candidates.push(input.filePath);
  }

  if (input.toolInput) {
    if (typeof input.toolInput.path === 'string')
      candidates.push(input.toolInput.path);
    if (typeof input.toolInput.filePath === 'string')
      candidates.push(input.toolInput.filePath);
    if (typeof input.toolInput.file_path === 'string')
      candidates.push(input.toolInput.file_path);

    /** editFiles (GPT5.3codex / Codex): files[] — string[] or {path/filePath}[] */
    const tiFiles = (input.toolInput as Record<string, unknown>).files;
    if (Array.isArray(tiFiles)) {
      for (const f of tiFiles) {
        if (typeof f === 'string') {
          candidates.push(f);
          break;
        } else if (typeof f === 'object' && f !== null) {
          const rec = f as Record<string, unknown>;
          for (const key of ['filePath', 'file_path', 'path']) {
            if (typeof rec[key] === 'string') {
              candidates.push(rec[key] as string);
              break;
            }
          }
          break;
        }
      }
    }
  }

  /** VS Code chatHooks v6 sends tool_input (snake_case) as a JSON string. */
  let parsedToolInput: HookRecord = {};
  if (typeof input.tool_input === 'string') {
    try {
      parsedToolInput = JSON.parse(input.tool_input) as HookRecord;
    } catch {
      parsedToolInput = {};
    }
  } else if (
    typeof input.tool_input === 'object' &&
    input.tool_input !== null
  ) {
    parsedToolInput = input.tool_input as HookRecord;
  }
  if (typeof parsedToolInput.filePath === 'string')
    candidates.push(parsedToolInput.filePath);
  if (typeof parsedToolInput.file_path === 'string')
    candidates.push(parsedToolInput.file_path);
  if (typeof parsedToolInput.path === 'string')
    candidates.push(parsedToolInput.path);

  /** editFiles via tool_input (snake_case payload): files[] */
  if (Array.isArray(parsedToolInput.files)) {
    for (const f of parsedToolInput.files) {
      if (typeof f === 'string') {
        candidates.push(f);
        break;
      } else if (typeof f === 'object' && f !== null) {
        const rec = f as Record<string, unknown>;
        for (const key of ['filePath', 'file_path', 'path']) {
          if (typeof rec[key] === 'string') {
            candidates.push(rec[key] as string);
            break;
          }
        }
        break;
      }
    }
  }

  let parsedArgs: HookRecord = {};
  if (typeof input.toolArgs === 'string') {
    try {
      parsedArgs = JSON.parse(input.toolArgs) as HookRecord;
    } catch {
      parsedArgs = {};
    }
  } else if (typeof input.toolArgs === 'object' && input.toolArgs !== null) {
    parsedArgs = input.toolArgs as HookRecord;
  }

  if (typeof parsedArgs.filePath === 'string')
    candidates.push(parsedArgs.filePath);
  if (typeof parsedArgs.file_path === 'string')
    candidates.push(parsedArgs.file_path);

  /** editFiles via toolArgs: files[] */
  if (Array.isArray(parsedArgs.files)) {
    for (const f of parsedArgs.files as unknown[]) {
      if (typeof f === 'string') {
        candidates.push(f);
        break;
      } else if (typeof f === 'object' && f !== null) {
        const rec = f as Record<string, unknown>;
        for (const key of ['filePath', 'file_path', 'path']) {
          if (typeof rec[key] === 'string') {
            candidates.push(rec[key] as string);
            break;
          }
        }
        break;
      }
    }
  }

  const nestedInput = parsedArgs.input as HookRecord | undefined;
  if (nestedInput && typeof nestedInput.filePath === 'string') {
    candidates.push(nestedInput.filePath);
  }

  return candidates.find((v) => v.trim().length > 0) ?? process.argv[2];
}

/**
 * Extract the session ID from hook input.
 * VS Code chatHooks sends `session_id` (snake_case); some internal callers
 * may use `sessionId` (camelCase). Returns null when neither is present.
 *
 * @param hookInput - Hook payload
 * @returns Session ID string or null
 */
export function extractSessionId(hookInput: HookRecord): string | null {
  if (
    typeof hookInput.session_id === 'string' &&
    hookInput.session_id.length > 0
  ) {
    return hookInput.session_id;
  }
  if (
    typeof hookInput.sessionId === 'string' &&
    hookInput.sessionId.length > 0
  ) {
    return hookInput.sessionId;
  }
  return null;
}

/**
 * Detect nested hook execution to prevent re-entry loops.
 * Session-end hooks can trigger tool use, which triggers more hooks.
 *
 * @param hookInput - Hook payload
 * @returns True if guard flags indicate nested hook execution
 */
export function isNestedHookRun(hookInput: HookRecord): boolean {
  return (
    hookInput.stop_hook_active === true ||
    hookInput.session_end_hook_active === true ||
    hookInput.sessionEnd_hook_active === true
  );
}
