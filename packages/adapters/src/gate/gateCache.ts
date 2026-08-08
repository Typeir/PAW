/**
 * PAW Gate Cache (warm)
 *
 * @fileoverview The {@link GateRunner} the resident daemon owns (doc 10 §8b): it
 * imports each gate once and keeps it, paying the loader cost at daemon start
 * rather than per tool call. Invalidation is by `mtimeMs` **and** `size` — size
 * catches an edit that lands in the same millisecond, which mtime alone would
 * miss — and a changed gate is re-imported with a `?v=<mtime>` cache-buster,
 * because ESM resolution is otherwise permanently memoised. Removed gates and a
 * vanished gates directory are dropped, so the cache follows the project.
 *
 * @module @paw/adapters/gate/gateCache
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GateRunner, HealthReport, QualityGate } from '@paw/core';
import { GATE_FILE, executeGates } from './gateExec.js';

/**
 * A cached gate with the file stats that validate it.
 *
 * @interface CachedGate
 * @property {number} mtimeMs - Last-modified time when imported.
 * @property {number} size - File size when imported.
 * @property {QualityGate} gate - The loaded gate.
 */
interface CachedGate {
  mtimeMs: number;
  size: number;
  gate: QualityGate;
}

/**
 * Return the current gates, importing only those new or changed since last time
 * and dropping any that vanished.
 *
 * @param {string} gatesDir - Absolute `.paw/gates` path.
 * @param {Map<string, CachedGate>} cache - The per-file cache to maintain.
 * @returns {Promise<QualityGate[]>} The current gates.
 */
async function loadCached(
  gatesDir: string,
  cache: Map<string, CachedGate>,
): Promise<QualityGate[]> {
  if (!existsSync(gatesDir)) {
    cache.clear();
    return [];
  }
  const files = readdirSync(gatesDir).filter((f) => GATE_FILE.test(f));
  const present = new Set(files);
  for (const key of [...cache.keys()]) {
    if (!present.has(key)) {
      cache.delete(key);
    }
  }
  const gates: QualityGate[] = [];
  for (const file of files) {
    const full = path.join(gatesDir, file);
    const stat = statSync(full);
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
      gates.push(hit.gate);
      continue;
    }
    const url = `${pathToFileURL(full).href}?v=${stat.mtimeMs}`;
    const mod = (await import(url)) as { gate?: QualityGate };
    if (mod.gate && typeof mod.gate.check === 'function') {
      cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, gate: mod.gate });
      gates.push(mod.gate);
    } else {
      cache.delete(file);
    }
  }
  return gates;
}

/**
 * Create a warm {@link GateRunner} bound to a project root. The cache lives for
 * the runner's lifetime — the daemon's.
 *
 * @param {string} rootDir - Absolute project root; gates live under `.paw/gates`.
 * @returns {GateRunner} A runner that imports gates once and invalidates by stat.
 */
export function createGateCache(rootDir: string): GateRunner {
  const cache = new Map<string, CachedGate>();
  const gatesDir = path.join(rootDir, '.paw', 'gates');
  return {
    async runForFiles(relativePaths: readonly string[]): Promise<HealthReport> {
      const gates = await loadCached(gatesDir, cache);
      return executeGates(rootDir, relativePaths, gates);
    },
  };
}
