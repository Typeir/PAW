/**
 * PAW CLI Presenter Adapter
 *
 * @fileoverview The CLI's driving adapter for {@link PresenterPort} — the seam
 * that lets one core back a CLI, a TUI, and a GUI. The write sink is injected so
 * the adapter is pure and unit-testable without touching `process.stdout`.
 *
 * @module @paw/cli/application/presenter
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { PresenterPort } from '@paw/core';

/**
 * Build a console presenter that renders through an injected line sink.
 *
 * @param write - Receives one fully-formed line at a time (no trailing newline).
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
