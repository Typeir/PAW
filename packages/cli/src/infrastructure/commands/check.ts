/**
 * PAW CLI — check command
 *
 * @fileoverview `paw check`: read decision-input from stdin, print allow/deny
 * decision, exit 0/2. Shell of enforcement decision, wraps stdin + `process.exit`;
 * decision itself come from `@paw/core`'s `decidePreToolUse`.
 *
 * @module @paw/cli/infrastructure/commands/check
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { decidePreToolUse, type PreToolInput, type Violation } from '@paw/core';
import { decisionToOutput } from '../../domain/render.js';
import { readStdin } from '../stdin.js';

/**
 * Run `check` subcommand: enforcement decision from stdin.
 *
 * @returns {Promise<never>} Never return; exit with decision code.
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
