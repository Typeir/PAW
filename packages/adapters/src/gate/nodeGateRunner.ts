/**
 * PAW Node Gate Runner (cold)
 *
 * @fileoverview A {@link GateRunner} for standalone path — CI, or hook with
 * no daemon. Find project `.paw/gates/`, import each gate fresh, run
 * them through {@link executeGates}. Import per call for process that run
 * once and exit; daemon use {@link module:@paw/adapters/gate/gateCache} to
 * import once and invalidate by mtime. Defer: subprocess-runner gates,
 * `dependsOn` ordering, inline `paw:gate` suppression.
 *
 * @module @paw/adapters/gate/nodeGateRunner
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GateRunner, HealthReport, QualityGate } from '@paw/core';
import { GATE_FILE, executeGates } from './gateExec.js';

/**
 * Discover and import gates under a gates directory. Skip module that no
 * export `gate` with `check` function.
 *
 * @param {string} gatesDir - Absolute `.paw/gates` path.
 * @returns {Promise<QualityGate[]>} The loaded gates.
 */
async function loadGates(gatesDir: string): Promise<QualityGate[]> {
  if (!existsSync(gatesDir)) {
    return [];
  }
  const gates: QualityGate[] = [];
  for (const file of readdirSync(gatesDir).filter((f) => GATE_FILE.test(f))) {
    const url = pathToFileURL(path.join(gatesDir, file)).href;
    const mod = (await import(url)) as { gate?: QualityGate };
    if (mod.gate && typeof mod.gate.check === 'function') {
      gates.push(mod.gate);
    }
  }
  return gates;
}

/**
 * Create cold {@link GateRunner} bound to project root.
 *
 * @param {string} rootDir - Absolute project root; gates live under `.paw/gates`.
 * @returns {GateRunner} Runner that import and gate each call.
 */
export function createNodeGateRunner(rootDir: string): GateRunner {
  return {
    async runForFiles(relativePaths: readonly string[]): Promise<HealthReport> {
      const gates = await loadGates(path.join(rootDir, '.paw', 'gates'));
      return executeGates(rootDir, relativePaths, gates);
    },
  };
}
