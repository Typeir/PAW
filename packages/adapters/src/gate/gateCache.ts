/**
 * PAW gate cache (warm)
 *
 * @fileoverview Cache held by the resident daemon (doc 10 §8b). Import each
 * gate once at daemon start and keep it. Invalidate by `mtimeMs` and `size`;
 * size also detects edits within the same millisecond. Re-import changed gates
 * with a `?v=<mtime>` cache-buster to bypass ESM memoisation. Remove gates that
 * no longer exist, and clear the cache when the gates directory is gone.
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
 * Cached gate with file stats that validate it.
 *
 * @interface CachedGate
 * @property {number} mtimeMs - Last-modified time when imported.
 * @property {number} size - File size when imported.
 * @property {QualityGate} gate - Loaded gate.
 */
interface CachedGate {
  mtimeMs: number;
  size: number;
  gate: QualityGate;
}

/**
 * Return current gates. Import only new or changed since last time. Drop any
 * that vanished.
 *
 * @param {string} gatesDir - Absolute `.paw/gates` path.
 * @param {Map<string, CachedGate>} cache - Per-file cache to maintain.
 * @returns {Promise<QualityGate[]>} Current gates.
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
 * Create warm {@link GateRunner} bound to project root. Cache live for runner
 * lifetime — the daemon's.
 *
 * @param {string} rootDir - Absolute project root; gates live under `.paw/gates`.
 * @returns {GateRunner} Runner import gates once, invalidate by stat.
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
