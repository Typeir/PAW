/**
 * PAW CLI rendering.
 *
 * @fileoverview Pure render for CLI consumer. {@link Decision} become text plus
 * exit code. No I/O. Process shell read stdin, call `process.exit`, live in
 * `main.ts`, per CONSTRAINTS.md Constraint 1.
 *
 * @module @paw/cli/domain/render
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { Decision } from '@paw/core';

/**
 * Rendered CLI result.
 *
 * @property text - What to print.
 * @property exitCode - 0 allow, 2 deny. Mirror hook contract where exit 2
 *   block veto.
 */
export interface CliOutput {
  readonly text: string;
  readonly exitCode: number;
}

/**
 * Render decision to console output and exit code.
 *
 * @param d - Decision from `@paw/core`.
 * @returns Text to print and process exit code.
 */
export function decisionToOutput(d: Decision): CliOutput {
  if (d.kind === 'allow') {
    const ctx = d.additionalContext ? `\n${d.additionalContext}` : '';
    return { text: `ALLOW${ctx}`, exitCode: 0 };
  }
  return { text: `DENY\n${d.reason}`, exitCode: 2 };
}
