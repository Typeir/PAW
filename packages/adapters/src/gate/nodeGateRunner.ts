/**
 * PAW Node Gate Runner (cold)
 *
 * @fileoverview A {@link GateRunner} for the standalone path — CI, or a hook with
 * no daemon: it discovers a project's `.paw/gates/`, imports each gate fresh, and
 * runs them through {@link executeGates}. Import-per-call is right for a process
 * that runs once and exits; the daemon uses {@link module:@paw/adapters/gate/gateCache}
 * to import once and invalidate by mtime instead. Deferred from main for now
 * (each a clean later addition): subprocess-runner gates, `dependsOn` ordering,
 * inline `paw:gate` suppression.
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
 * Discover and import the gates under a gates directory. A module that does not
 * export a `gate` with a `check` function is skipped, as in the legacy loader.
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
 * Create a cold {@link GateRunner} bound to a project root.
 *
 * @param {string} rootDir - Absolute project root; gates live under `.paw/gates`.
 * @returns {GateRunner} A runner that imports and gates on each call.
 */
export function createNodeGateRunner(rootDir: string): GateRunner {
  return {
    async runForFiles(relativePaths: readonly string[]): Promise<HealthReport> {
      const gates = await loadGates(path.join(rootDir, '.paw', 'gates'));
      return executeGates(rootDir, relativePaths, gates);
    },
  };
}
