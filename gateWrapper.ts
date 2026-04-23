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
 * @author Typeir
 * @version 1.0.0
 * @since 3.0.0
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSingleFileContext } from './gateContext';
import type { GateResult, QualityGate } from './healthCheckTypes';

/**
 * Read all data from stdin as a UTF-8 string.
 *
 * @returns Full stdin contents as a string
 */
async function readStdinText(): Promise<string> {
  let data = '';
  for await (const chunk of process.stdin) {
    data += chunk.toString();
  }
  return data;
}

/**
 * Serialize a gate-level error as a failed GateResult JSON and exit with code 0.
 * Exit code 0 is used deliberately — VS Code reads the JSON output, not the exit code.
 *
 * @param err - Error to serialize into the result
 */
function outputErrorResult(err: unknown): void {
  const errorMessage = err instanceof Error ? err.message : String(err);
  console.log(
    JSON.stringify({
      passed: false,
      severity: 'critical',
      findings: [{ rule: 'gate-error', message: errorMessage }],
    } as GateResult),
  );
  process.exit(0);
}

/**
 * Main entrypoint.
 */
async function main(): Promise<void> {
  try {
    const gatePath = process.argv[2];
    if (!gatePath) {
      process.stderr.write('ERROR: Gate path required as first argument\n');
      process.exit(1);
    }

    const stdinData = await readStdinText();
    const contextData = JSON.parse(stdinData);

    const context = buildSingleFileContext(
      contextData.rootDir,
      contextData.changedFiles ?? [],
    );

    const moduleUrl = pathToFileURL(path.resolve(gatePath)).href;
    const mod = await import(moduleUrl);

    const gate: QualityGate = mod.gate ?? mod.default?.gate;
    if (!gate || typeof gate.check !== 'function') {
      throw new Error(
        `Invalid gate: ${gatePath} does not export 'gate' with check() method`,
      );
    }

    const result: GateResult = await gate.check(context);
    console.log(JSON.stringify(result));
  } catch (err: unknown) {
    outputErrorResult(err);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `FATAL: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
