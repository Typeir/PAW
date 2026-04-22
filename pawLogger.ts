/**
 * PAW Logger
 *
 * @fileoverview File-based logging for PAW components. In CLI context, also outputs
 * to terminal via @clack/prompts. In hook/subprocess context (where stdout is captured),
 * logs go directly to .ignore/paw-logs/.
 *
 * @module .github/PAW/paw-logger
 * @author Typeir
 * @version 2.0.0
 * @since 3.0.0
 */

import { spinner as clackSpinner } from '@clack/prompts';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const PAW_LOGS_DIR = '.ignore/paw-logs';
const SESSION_START = new Date()
  .toISOString()
  .replace(/[:.]/g, '-')
  .slice(0, 19);
const LOG_FILE = path.join(PAW_LOGS_DIR, `paw-${SESSION_START}.log`);

/**
 * Detect if running in a hook context (no TTY, stdin is not a terminal).
 * In hook context, suppress all console output and only log to file.
 */
const IN_HOOK_CONTEXT = !process.stdout.isTTY;

/**
 * Initialize log directory.
 */
function initLogsDir(): void {
  try {
    mkdirSync(PAW_LOGS_DIR, { recursive: true });
  } catch {
    // Ignore errors
  }
}

/**
 * Write a log line to file with timestamp.
 *
 * @param level - Log level (info, warn, error, debug)
 * @param message - Message text
 */
function writeLog(level: string, message: string): void {
  try {
    initLogsDir();
    const timestamp = new Date().toISOString();
    const processId = process.pid;
    const line = `${timestamp} [${level}] [#${processId}] ${message}\n`;
    appendFileSync(LOG_FILE, line, 'utf-8');
  } catch {
    // Silently fail if logging fails
  }
}

/**
 * Print a PAW intro banner.
 *
 * @param title - Title text shown in the intro bar
 */
export function pawIntro(title: string): void {
  writeLog('info', `[CLI] Intro: ${title}`);
  if (!IN_HOOK_CONTEXT) {
    process.stderr.write(`\n┌─ ${title}\n│\n`);
  }
}

/**
 * Print a PAW outro banner.
 *
 * @param message - Closing message
 */
export function pawOutro(message: string): void {
  writeLog('info', `[CLI] Outro: ${message}`);
  if (!IN_HOOK_CONTEXT) {
    process.stderr.write(`│\n└─ ${message}\n\n`);
  }
}

/**
 * Log an informational message.
 *
 * @param message - Message text
 */
export function info(message: string): void {
  writeLog('info', message);
  if (!IN_HOOK_CONTEXT) {
    process.stderr.write(`ℹ  ${message}\n`);
  }
}

/**
 * Log a success message.
 *
 * @param message - Message text
 */
export function success(message: string): void {
  writeLog('info', `✓ ${message}`);
  if (!IN_HOOK_CONTEXT) {
    process.stderr.write(`✓ ${message}\n`);
  }
}

/**
 * Log a warning message.
 *
 * @param message - Message text
 */
export function warn(message: string): void {
  writeLog('warn', message);
  if (!IN_HOOK_CONTEXT) {
    process.stderr.write(`⚠ ${message}\n`);
  }
}

/**
 * Log an error message.
 *
 * @param message - Message text
 */
export function error(message: string): void {
  writeLog('error', message);
  if (!IN_HOOK_CONTEXT) {
    process.stderr.write(`✖ ${message}\n`);
  }
}

/**
 * Log a debug message (file only).
 *
 * @param message - Message text
 */
export function debug(message: string): void {
  writeLog('debug', message);
}

/**
 * Log a step/progress message.
 *
 * @param message - Message text
 */
export function step(message: string): void {
  writeLog('info', `→ ${message}`);
  if (!IN_HOOK_CONTEXT) {
    process.stderr.write(`→ ${message}\n`);
  }
}

/**
 * Log a plain message (no icon prefix).
 *
 * @param message - Message text
 */
export function message(message: string): void {
  writeLog('info', message);
  if (!IN_HOOK_CONTEXT) {
    process.stderr.write(`${message}\n`);
  }
}

/**
 * Create a spinner for long-running operations.
 * In hook context (TTY=false), returns a no-op spinner to prevent
 * ANSI animation codes from polluting stdout/JSON responses.
 *
 * @returns Spinner with start/stop methods
 */
export function spin(): ReturnType<typeof clackSpinner> {
  if (IN_HOOK_CONTEXT) {
    // Return a no-op spinner for hook context
    return {
      start: () => {},
      stop: () => {},
    } as ReturnType<typeof clackSpinner>;
  }
  return clackSpinner();
}

/**
 * Get the current log file path.
 *
 * @returns Path to the current session's log file
 */
export function getLogFile(): string {
  return LOG_FILE;
}
