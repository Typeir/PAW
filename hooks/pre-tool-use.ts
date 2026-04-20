/**
 * PAW Default Pre Tool Use Hook
 *
 * @fileoverview Enforces the violation feedback loop by denying tool execution
 * when unresolved violations exist in paw.sqlite for the CURRENT SESSION.
 * Violations are session-scoped — session A's violations don't block session B.
 * Project-scoped violations (session_id = NULL) block all sessions.
 *
 * Customize: Add or remove tools from EXEMPT_TOOLS to fit your workflow.
 *
 * Enforcement loop:
 *   1. postToolUse detects violations → inserts into SQLite → blocks
 *   2. preToolUse queries SQLite for unresolved → denies non-exempt tools
 *   3. Agent fixes file → postToolUse re-checks → resolves in SQLite
 *   4. preToolUse queries SQLite → no unresolved → allows tools again
 *
 * VS Code contract: PreToolUse uses permissionDecision: 'deny' to block tools.
 * Exit code 2 = blocking error per chatHooks spec.
 *
 * @module .paw/hooks/pre-tool-use
 * @author PAW
 * @version 7.0.0
 * @since 3.0.0
 */

import {
  extractSessionId,
  readHookInput,
  writeDenyOutput,
  writeHookOutput,
} from '../../.github/PAW/hook-runtime';
import {
  DEFAULT_DB_PATH,
  getPawConfig,
  getSessionViolations,
  getUnresolvedViolations,
  normalizePath,
  openDb,
  openDbReadonly,
  pruneOrphanedViolations,
  type ViolationRow,
} from '../../.github/PAW/paw-db';
import {
  isPathIgnored,
  PROJECT_ROOT as ROOT,
  toProjectRelative,
} from '../../.github/PAW/paw-paths';
import { runPlugins } from '../../.github/PAW/plugin-loader';
import { resolveStaleIndirectViolations } from '../../.github/PAW/resolve-indirect-violations';

/**
 * Tools that are always allowed, even during violation enforcement.
 * Read-only tools must not be blocked — the agent needs them to diagnose issues.
 */
const EXEMPT_TOOLS = new Set([
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
 * Extract all file paths mentioned in tool arguments.
 * Handles all three payload formats VS Code may send:
 *   - toolInput (camelCase object — VS Code chatHooks v6+)
 *   - tool_input (snake_case, JSON string or object)
 *   - toolArgs (legacy/alternative)
 *
 * @param {Record<string, unknown>} hookInput - Hook payload
 * @returns Array of normalized file paths found in the tool args
 */
function extractToolFilePaths(hookInput: Record<string, unknown>): string[] {
  const paths: string[] = [];

  /**
   * Parse a single args source (string or object) into a flat record,
   * then extract known file-path keys from it.
   */
  function harvestPaths(source: unknown): void {
    let parsed: Record<string, unknown> = {};
    if (typeof source === 'string') {
      try {
        parsed = JSON.parse(source) as Record<string, unknown>;
      } catch {
        return;
      }
    } else if (typeof source === 'object' && source !== null) {
      parsed = source as Record<string, unknown>;
    } else {
      return;
    }

    /** Direct filePath / path / file_path fields */
    for (const key of ['filePath', 'file_path', 'path']) {
      if (typeof parsed[key] === 'string') {
        paths.push(normalizePath(parsed[key] as string));
      }
    }

    /** Nested input object: toolArgs.input.filePath (legacy VS Code payload format).
     *  resolveEditedFilePath in hook-runtime handles this for post-tool-use;
     *  mirror the same extraction here so paths stored in the DB are matchable. */
    if (typeof parsed.input === 'object' && parsed.input !== null) {
      const nested = parsed.input as Record<string, unknown>;
      for (const key of ['filePath', 'file_path', 'path']) {
        if (typeof nested[key] === 'string') {
          paths.push(normalizePath(nested[key] as string));
        }
      }
    }

    /** multi_replace_string_in_file: replacements[].filePath */
    if (Array.isArray(parsed.replacements)) {
      for (const r of parsed.replacements) {
        if (
          typeof r === 'object' &&
          r !== null &&
          typeof (r as Record<string, unknown>).filePath === 'string'
        ) {
          paths.push(
            normalizePath((r as Record<string, unknown>).filePath as string),
          );
        }
      }
    }

    /** editFiles (GPT5.3codex / Codex): files[] — string[] or {path/filePath}[] */
    if (Array.isArray(parsed.files)) {
      for (const f of parsed.files) {
        if (typeof f === 'string') {
          paths.push(normalizePath(f));
        } else if (typeof f === 'object' && f !== null) {
          const rec = f as Record<string, unknown>;
          for (const key of ['filePath', 'file_path', 'path']) {
            if (typeof rec[key] === 'string') {
              paths.push(normalizePath(rec[key] as string));
              break;
            }
          }
        }
      }
    }

    /** run_in_terminal: try to extract paths from the command string */
    if (typeof parsed.command === 'string') {
      const absPathPattern = /(?:[a-zA-Z]:[\\\/]|\/)[^\s"'`;|&<>]+/g;
      const matches = (parsed.command as string).match(absPathPattern);
      if (matches) {
        for (const m of matches) {
          paths.push(normalizePath(m));
        }
      }
    }
  }

  /** Top-level filePath (some tools send this at root level) */
  if (typeof hookInput.filePath === 'string') {
    paths.push(normalizePath(hookInput.filePath));
  }

  /** VS Code chatHooks v6+ sends toolInput as a camelCase object */
  harvestPaths(hookInput.toolInput);

  /** Some versions send tool_input (snake_case) as JSON string or object */
  harvestPaths(hookInput.tool_input);

  /** Legacy / alternative payload format */
  harvestPaths(hookInput.toolArgs);

  return paths;
}

/**
 * Check whether the tool is operating on any violated file.
 * Compares project-relative paths to avoid cross-platform absolute path mismatches.
 *
 * @param {Record<string, unknown>} hookInput - Hook payload
 * @param {ViolationRow[]} violations - Unresolved violation rows from SQLite
 * @returns True if the tool targets one of the violated files
 */
function isFixingViolatedFile(
  hookInput: Record<string, unknown>,
  violations: ViolationRow[],
): boolean {
  const toolPaths = extractToolFilePaths(hookInput);
  if (toolPaths.length === 0) return false;

  /** Only files with DIRECT violations are reachable for fixing.
   *  Files that have only indirect-fix violations are treated as clean —
   *  they must not grant edit access while other files have direct violations. */
  const violatedRelPaths = new Set(
    violations
      .filter((v) => v.indirect_fix === 0)
      .map((v) => toProjectRelative(v.file_path)),
  );

  const toolRelPaths = toolPaths.map(toProjectRelative);

  for (const toolRel of toolRelPaths) {
    if (violatedRelPaths.has(toolRel)) {
      return true;
    }
  }
  return false;
}

/**
 * Check whether ALL remaining violations are indirect-fix findings.
 * Gates declare this via `indirectFix: true` on individual GateFindings,
 * which is stored as `indirect_fix = 1` in the violations table.
 * When every unresolved violation is indirect-fix, all tools are unblocked
 * so the agent can create the required fix files.
 *
 * @param {ViolationRow[]} violations - Unresolved violation rows
 * @returns True if every violation has indirect_fix set
 */
function allViolationsAreIndirectFix(violations: ViolationRow[]): boolean {
  return violations.every((v) => v.indirect_fix === 1);
}

/**
 * Check whether ALL file paths targeted by the tool are pawignored.
 * If so the tool should be allowed through regardless of violations.
 *
 * @param {Record<string, unknown>} hookInput - Hook payload
 * @returns True if every file targeted by the tool is pawignored
 */
function isTargetingIgnoredFiles(hookInput: Record<string, unknown>): boolean {
  const toolPaths = extractToolFilePaths(hookInput);
  if (toolPaths.length === 0) return false;

  return toolPaths.every((absPath) =>
    isPathIgnored(toProjectRelative(absPath)),
  );
}

/**
 * Main hook entrypoint.
 */
async function main(): Promise<void> {
  try {
    const cfgDb = openDbReadonly(DEFAULT_DB_PATH);
    if (cfgDb) {
      try {
        if (getPawConfig(cfgDb, 'paw_state') === 'disabled') {
          writeHookOutput({ continue: true });
          return;
        }
      } finally {
        cfgDb.close();
      }
    }
  } catch {
    /* fail open */
  }

  const hookInput = await readHookInput();
  const toolName =
    typeof hookInput.tool_name === 'string'
      ? hookInput.tool_name
      : typeof hookInput.toolName === 'string'
        ? hookInput.toolName
        : '';

  if (EXEMPT_TOOLS.has(toolName)) {
    writeHookOutput({ continue: true });
    return;
  }

  const sessionId = extractSessionId(hookInput);

  let violations: ViolationRow[] = [];
  try {
    const db = openDbReadonly(DEFAULT_DB_PATH);
    if (!db) {
      writeHookOutput({ continue: true });
      return;
    }
    try {
      violations = sessionId
        ? getSessionViolations(db, sessionId)
        : getUnresolvedViolations(db);
    } finally {
      db.close();
    }
  } catch {
    writeHookOutput({ continue: true });
    return;
  }

  if (violations.length > 0) {
    const { existsSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const resolveAbsolute = (fp: string): string => {
      const isAbs = /^[a-z]:\//i.test(fp) || fp.startsWith('/');
      return isAbs ? fp : join(ROOT, fp);
    };
    const hasOrphans = violations.some(
      (v) => !existsSync(resolveAbsolute(v.file_path)),
    );
    if (hasOrphans) {
      try {
        const writeDb = openDb(DEFAULT_DB_PATH);
        try {
          pruneOrphanedViolations(writeDb);
        } finally {
          writeDb.close();
        }

        const readDb = openDbReadonly(DEFAULT_DB_PATH);
        if (readDb) {
          try {
            violations = sessionId
              ? getSessionViolations(readDb, sessionId)
              : getUnresolvedViolations(readDb);
          } finally {
            readDb.close();
          }
        }
      } catch {
        violations = violations.filter((v) =>
          existsSync(resolveAbsolute(v.file_path)),
        );
      }
    }
  }

  /** Resolve stale indirect-fix violations (e.g. test file now exists). */
  if (violations.some((v) => v.indirect_fix === 1)) {
    const resolution = resolveStaleIndirectViolations(sessionId);
    if (resolution.resolved > 0) {
      try {
        const freshDb = openDbReadonly(DEFAULT_DB_PATH);
        if (freshDb) {
          try {
            violations = sessionId
              ? getSessionViolations(freshDb, sessionId)
              : getUnresolvedViolations(freshDb);
          } finally {
            freshDb.close();
          }
        }
      } catch {
        violations = violations.filter(
          (v) => !resolution.resolvedFiles.includes(v.file_path),
        );
      }
    }
  }

  if (violations.length === 0) {
    writeHookOutput({ continue: true });
    return;
  }

  if (isTargetingIgnoredFiles(hookInput)) {
    writeHookOutput({ continue: true });
    return;
  }

  if (isFixingViolatedFile(hookInput, violations)) {
    writeHookOutput({ continue: true });
    return;
  }

  if (allViolationsAreIndirectFix(violations)) {
    const indirectGrouped = new Map<string, string[]>();
    for (const v of violations) {
      const msgs = indirectGrouped.get(v.file_path) ?? [];
      msgs.push(v.message);
      indirectGrouped.set(v.file_path, msgs);
    }
    const nudgeLines = [
      `⚠️ INDIRECT FIX REQUIRED — The following violations cannot be resolved by editing the flagged file (e.g. a missing test must be created as a new file). Address these BEFORE resuming your assigned task.`,
      '',
    ];
    for (const [filePath, msgs] of indirectGrouped) {
      nudgeLines.push(`File: ${filePath}`);
      for (const m of msgs) {
        nudgeLines.push(`  - ${m}`);
      }
      nudgeLines.push('');
    }
    nudgeLines.push(
      'Create or update the required fix file(s) first, then continue with your task.',
    );
    writeHookOutput({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: nudgeLines.join('\n'),
      },
    });
    return;
  }

  const pluginResult = await runPlugins('pre-tool-use', hookInput, null);

  const grouped = new Map<string, string[]>();
  for (const v of violations) {
    const msgs = grouped.get(v.file_path) ?? [];
    msgs.push(v.message);
    grouped.set(v.file_path, msgs);
  }

  const lines = [
    `\uD83D\uDEAB Outstanding violations must be fixed before using other tools.`,
    '',
  ];
  for (const [filePath, msgs] of grouped) {
    lines.push(`File: ${filePath}`);
    for (const m of msgs) {
      lines.push(`  - ${m}`);
    }
    lines.push('');
  }
  lines.push('Fix the violated file(s) first, then this tool will be allowed.');

  if (pluginResult.messages.length > 0) {
    lines.push('', ...pluginResult.messages);
  }

  writeDenyOutput(lines.join('\n'));
}

main().catch(() => {
  writeHookOutput({ continue: true });
});
