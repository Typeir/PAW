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

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spinner as clackSpinner, intro, log, outro } from '@clack/prompts';

const PAW_LOGS_DIR = '.ignore/paw-logs';
const SESSION_START = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const LOG_FILE = path.join(PAW_LOGS_DIR, `paw-${SESSION_START}.log`);

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
  intro(title);
}

/**
 * Print a PAW outro banner.
 *
 * @param message - Closing message
 */
export function pawOutro(message: string): void {
  writeLog('info', `[CLI] Outro: ${message}`);
  outro(message);
}

/**
 * Log an informational message.
 *
 * @param message - Message text
 */
export function info(message: string): void {
  writeLog('info', message);
  log.info(message);
}

/**
 * Log a success message.
 *
 * @param message - Message text
 */
export function success(message: string): void {
  writeLog('info', `✓ ${message}`);
  log.success(message);
}

/**
 * Log a warning message.
 *
 * @param message - Message text
 */
export function warn(message: string): void {
  writeLog('warn', message);
  log.warn(message);
}

/**
 * Log an error message.
 *
 * @param message - Message text
 */
export function error(message: string): void {
  writeLog('error', message);
  log.error(message);
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
  log.step(message);
}

/**
 * Log a plain message (no icon prefix).
 *
 * @param message - Message text
 */
export function message(message: string): void {
  writeLog('info', message);
  log.message(message);
}

/**
 * Create a spinner for long-running operations.
 *
 * @returns Spinner with start/stop methods
 */
export function spin(): ReturnType<typeof clackSpinner> {
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
