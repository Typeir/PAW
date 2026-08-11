/**
 * PAW CLI Presenter Adapter
 *
 * @fileoverview CLI driving adapter for {@link PresenterPort}. CLI, TUI, and
 * GUI each drive one shared core. Write sink injected; adapter no touch
 * `process.stdout`.
 *
 * @module @paw/cli/application/presenter
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { PresenterPort } from '@paw/core';

/**
 * Build console presenter. Render through injected line sink.
 *
 * @param write - Receive one fully-formed line at a time (no trailing newline).
 * @returns A {@link PresenterPort} implementation.
 */
export function makeConsolePresenter(
  write: (line: string) => void,
): PresenterPort {
  return {
    info: (m) => write(`  ${m}`),
    success: (m) => write(`✓ ${m}`),
    warn: (m) => write(`⚠ ${m}`),
    error: (m) => write(`✗ ${m}`),
    table: (rows) => {
      for (const row of rows) {
        write(Object.values(row).join('  '));
      }
    },
  };
}
