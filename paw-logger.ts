/**
 * PAW Logger
 *
 * @fileoverview Centralized logging for all PAW output using @clack/prompts.
 * All PAW modules should import from this file instead of calling console
 * directly. This ensures consistent, styled terminal output across the
 * entire PAW system.
 *
 * @module .github/PAW/paw-logger
 * @author PAW
 * @version 1.0.0
 * @since 3.0.0
 */

import { intro, outro, log, spinner as clackSpinner } from '@clack/prompts';

/**
 * Print a PAW intro banner.
 *
 * @param title - Title text shown in the intro bar
 */
export function pawIntro(title: string): void {
  intro(title);
}

/**
 * Print a PAW outro banner.
 *
 * @param message - Closing message
 */
export function pawOutro(message: string): void {
  outro(message);
}

/**
 * Log an informational message.
 *
 * @param message - Message text
 */
export function info(message: string): void {
  log.info(message);
}

/**
 * Log a success message.
 *
 * @param message - Message text
 */
export function success(message: string): void {
  log.success(message);
}

/**
 * Log a warning message.
 *
 * @param message - Message text
 */
export function warn(message: string): void {
  log.warn(message);
}

/**
 * Log an error message.
 *
 * @param message - Message text
 */
export function error(message: string): void {
  log.error(message);
}

/**
 * Log a step/progress message.
 *
 * @param message - Message text
 */
export function step(message: string): void {
  log.step(message);
}

/**
 * Log a plain message (no icon prefix).
 *
 * @param message - Message text
 */
export function message(message: string): void {
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
