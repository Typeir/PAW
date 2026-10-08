/**
 * PAW Hook Payload Readers
 *
 * @fileoverview Field readers every hook connector share. Hosts name the same
 * things differently and in both casings; these read them. Command text feeds
 * {@link envMatch} only, never `targetPaths`, so a shell word is never taken
 * for a file the enforcement loop tracks.
 *
 * @module @paw/connectors/hookPayload
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { isEnvFile } from '@paw/core';

/**
 * Payload keys that carry tool arguments, in every host casing.
 */
const ARG_SOURCES = ['toolInput', 'tool_input', 'toolArgs'] as const;

/**
 * Argument keys that carry one file path.
 */
const PATH_KEYS = ['path', 'filePath', 'file_path', 'notebookPath', 'notebook_path'] as const;

/**
 * Argument keys that carry shell command text.
 */
const COMMAND_KEYS = ['command'] as const;

/**
 * Shell word separators and redirection characters.
 */
const SHELL_SPLIT = /[\s;|&<>()]+/;

/**
 * Coerce value to non-empty string, or null.
 *
 * @param {unknown} v - Value.
 * @returns {string | null} The string, or null.
 */
export function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Parse tool-args source, object or JSON string. Malformed input yield null;
 * caller treat null as "no arguments here".
 *
 * @param {unknown} src - Source value.
 * @returns {Record<string, unknown> | null} Parsed record, or null.
 */
export function asArgs(src: unknown): Record<string, unknown> | null {
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
 * Every tool-argument record the payload carry.
 *
 * @param {Record<string, unknown>} raw - The hook payload.
 * @returns {Record<string, unknown>[]} Parsed argument records.
 */
function argRecords(raw: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const source of ARG_SOURCES) {
    const args = asArgs(raw[source]);
    if (args !== null) {
      out.push(args);
    }
  }
  return out;
}

/**
 * Path with forward slashes.
 *
 * @param {string} path - Path in either slash style.
 * @returns {string} Path with forward slashes.
 */
function normalise(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Extract file paths the payload reference, normalised and deduped.
 *
 * @param {Record<string, unknown>} raw - The hook payload.
 * @returns {string[]} The referenced paths.
 */
export function extractPaths(raw: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const args of argRecords(raw)) {
    for (const key of PATH_KEYS) {
      const value = args[key];
      if (typeof value === 'string') {
        paths.push(normalise(value));
      }
    }
  }
  return [...new Set(paths)];
}

/**
 * Extract shell command text the payload carry.
 *
 * @param {Record<string, unknown>} raw - The hook payload.
 * @returns {string[]} The command strings.
 */
export function extractCommands(raw: Record<string, unknown>): string[] {
  const commands: string[] = [];
  for (const args of argRecords(raw)) {
    for (const key of COMMAND_KEYS) {
      const value = args[key];
      if (typeof value === 'string') {
        commands.push(value);
      }
    }
  }
  return commands;
}

/**
 * Path-like words of a shell command: split on separators, drop wrapping
 * quotes, normalise slashes.
 *
 * @param {string} command - Command text.
 * @returns {string[]} Candidate paths.
 */
function commandWords(command: string): string[] {
  return command
    .split(SHELL_SPLIT)
    .map((word) => normalise(word.replace(/^['"]+/, '').replace(/['"]+$/, '')))
    .filter((word) => word.length > 0);
}

/**
 * First environment file the tool reach, by path or by shell word, or null.
 * Callers make an enforcement decision on the returned path.
 *
 * @param {readonly string[]} paths - Candidate paths.
 * @param {readonly string[]} [commands] - Shell command text the tool run.
 * @returns {string | null} The matching path, or null.
 */
export function envMatch(
  paths: readonly string[],
  commands: readonly string[] = [],
): string | null {
  const direct = paths.find(isEnvFile);
  if (direct !== undefined) {
    return direct;
  }
  for (const command of commands) {
    const word = commandWords(command).find(isEnvFile);
    if (word !== undefined) {
      return word;
    }
  }
  return null;
}

/**
 * Session id from either casing.
 *
 * @param {Record<string, unknown>} raw - The hook payload.
 * @returns {string | null} The session id, or null.
 */
export function sessionId(raw: Record<string, unknown>): string | null {
  return str(raw.session_id) ?? str(raw.sessionId);
}

/**
 * Tool name from either casing.
 *
 * @param {Record<string, unknown>} raw - The hook payload.
 * @returns {string} The tool name, or empty string.
 */
export function toolName(raw: Record<string, unknown>): string {
  return str(raw.tool_name) ?? str(raw.toolName) ?? '';
}
