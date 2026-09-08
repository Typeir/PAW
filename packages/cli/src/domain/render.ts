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
 * Which stream rendered text belong on.
 */
export type CliStream = 'stdout' | 'stderr';

/**
 * Rendered CLI result.
 *
 * @property text - What to print.
 * @property exitCode - 0 allow, 2 deny. Mirror hook contract where exit 2
 *   block veto.
 * @property stream - Where to write text. A deny go to stderr: a host that
 *   read exit 2 with no decision JSON take its block reason from stderr, so
 *   a reason on stdout be discarded.
 */
export interface CliOutput {
  readonly text: string;
  readonly exitCode: number;
  readonly stream: CliStream;
}

/**
 * Render decision to console output, stream, and exit code.
 *
 * @param d - Decision from `@paw/core`.
 * @returns Text to print, stream to print it on, and process exit code.
 */
export function decisionToOutput(d: Decision): CliOutput {
  if (d.kind === 'allow') {
    const ctx = d.additionalContext ? `\n${d.additionalContext}` : '';
    return { text: `ALLOW${ctx}`, exitCode: 0, stream: 'stdout' };
  }
  return { text: `DENY\n${d.reason}`, exitCode: 2, stream: 'stderr' };
}
