/**
 * PAW CLI Rendering
 *
 * @fileoverview Pure rendering for the CLI consumer: a {@link Decision} becomes
 * text plus an exit code. No I/O — this is the part the unit tests own to 100%.
 * The process shell that reads stdin and calls `process.exit` lives in `main.ts`
 * and is covered by the E2E, per CONSTRAINTS.md Constraint 1.
 *
 * @module @paw/cli/render
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { Decision } from '@paw/core';

/**
 * A rendered CLI result.
 *
 * @property text - What to print.
 * @property exitCode - 0 to allow, 2 to deny — mirroring the hook contract where
 *   exit 2 is a blocking veto.
 */
export interface CliOutput {
  readonly text: string;
  readonly exitCode: number;
}

/**
 * Render a decision to console output and an exit code.
 *
 * @param d - The decision from `@paw/core`.
 * @returns The text to print and the process exit code.
 */
export function decisionToOutput(d: Decision): CliOutput {
  if (d.kind === 'allow') {
    const ctx = d.additionalContext ? `\n${d.additionalContext}` : '';
    return { text: `ALLOW${ctx}`, exitCode: 0 };
  }
  return { text: `DENY\n${d.reason}`, exitCode: 2 };
}
