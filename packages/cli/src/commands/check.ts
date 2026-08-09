/**
 * PAW CLI — check command
 *
 * @fileoverview `paw check`: read a decision-input on stdin, print the allow/deny
 * decision, and exit 0/2. This is the stdin + `process.exit` shell of the
 * enforcement decision; the decision itself is `@paw/core`'s `decidePreToolUse`.
 *
 * @module @paw/cli/commands/check
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { decidePreToolUse, type PreToolInput, type Violation } from '@paw/core';
import { decisionToOutput } from '../render.js';
import { readStdin } from '../stdin.js';

/**
 * Run the `check` subcommand: a stdin enforcement decision.
 *
 * @returns {Promise<never>} Never returns; exits with the decision's code.
 */
export async function runCheck(): Promise<never> {
  const wire = JSON.parse(await readStdin()) as {
    toolName: string;
    targetPaths?: string[];
    envMatch?: string | null;
    exemptTools?: string[];
    ignoredPaths?: string[];
    violations?: Violation[];
  };
  const input: PreToolInput = {
    toolName: wire.toolName,
    targetPaths: wire.targetPaths ?? [],
    envMatch: wire.envMatch ?? null,
    exemptTools: new Set(wire.exemptTools ?? []),
    ignoredPaths: new Set(wire.ignoredPaths ?? []),
    violations: wire.violations ?? [],
  };
  const out = decisionToOutput(decidePreToolUse(input));
  process.stdout.write(`${out.text}\n`);
  process.exit(out.exitCode);
}
