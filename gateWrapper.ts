/**
 * PAW Gate Subprocess Wrapper
 *
 * @fileoverview Wrapper for executing gates as subprocesses via tsx.
 * Receives gate path as argument, reads GateContext from stdin,
 * imports the gate, executes check(), and outputs JSON result.
 *
 * Usage: node tsx dist/cli.mjs gate-path.gate.ts < stdin
 *
 * @module .paw/gate-wrapper.ts
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  GateContext,
  GateResult,
  QualityGate,
} from './healthCheckTypes';
import { buildGateContext } from './gateContext';

/**
 * Main entrypoint.
 */
async function main(): Promise<void> {
  try {
    // Get gate path from CLI argument
    const gatePath = process.argv[2];
    if (!gatePath) {
      process.stderr.write('ERROR: Gate path required as first argument\n');
      process.exit(1);
    }

    // Read GateContext from stdin
    let stdinData = '';
    for await (const chunk of process.stdin) {
      stdinData += chunk.toString();
    }

    const contextData = JSON.parse(stdinData);

    // Build GateContext from serialized data
    const context = await buildGateContext(
      contextData.rootDir,
      contextData.mode,
      contextData.changedFiles,
    );

    // Import the gate module
    const moduleUrl = pathToFileURL(path.resolve(gatePath)).href;
    const mod = await import(moduleUrl);

    const gate: QualityGate = mod.gate ?? mod.default?.gate;
    if (!gate || typeof gate.check !== 'function') {
      throw new Error(
        `Invalid gate: ${gatePath} does not export 'gate' with check() method`,
      );
    }

    // Execute the gate
    const result: GateResult = await gate.check(context);

    // Output JSON result
    console.log(JSON.stringify(result));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Output error as a proper GateResult
    console.log(
      JSON.stringify({
        passed: false,
        severity: 'critical',
        findings: [
          {
            rule: 'gate-error',
            message,
          },
        ],
      } as GateResult),
    );
    process.exit(0); // Don't exit with error — output JSON instead
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `FATAL: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
