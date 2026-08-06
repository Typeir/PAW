/**
 * PAW Console Snapshot Hydration
 *
 * @fileoverview The anti-corruption layer between the wire and the console: it
 * maps `@paw/core`'s {@link PawSnapshot} — the plain, JSON-safe shape `pawd`
 * serves at `/api/state` — into the module's own {@link ConsoleData}, so no
 * component ever depends on a transport shape and a contract change lands in
 * exactly one file. It also enforces the contract at the boundary: a snapshot
 * whose brief and slug arrays disagree with its own member count is a producer
 * defect, and this throws rather than rendering a console that silently omits
 * members.
 *
 * @module @paw/gui/application/hydrateSnapshot
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { PawSnapshot } from '@paw/core';
import type { ConsoleData } from '../domain/console.types.js';

/**
 * Assert that a pre-rendered per-member array covers every member.
 *
 * @param {readonly string[]} values - The array the producer sent.
 * @param {number} total - The member count the producer declared.
 * @param {string} what - What the array holds, for the error message.
 */
function assertCovers(values: readonly string[], total: number, what: string): void {
  if (values.length !== total) {
    throw new Error(
      `PAW console: snapshot declares ${total} members but sent ${values.length} ${what}`,
    );
  }
}

/**
 * Map a wire snapshot to the console's data.
 *
 * @param {PawSnapshot} snapshot - The snapshot as served by `pawd`.
 * @returns {ConsoleData} The console's view of it.
 */
export function hydrate(snapshot: PawSnapshot): ConsoleData {
  assertCovers(snapshot.briefs, snapshot.memberTotal, 'briefs');
  assertCovers(snapshot.slugs, snapshot.memberTotal, 'slugs');
  return {
    host: snapshot.host,
    processes: snapshot.processes,
    configPath: snapshot.configPath,
    plans: snapshot.plans,
    selectedPlan: snapshot.selectedPlan,
    plan: {
      name: snapshot.planName,
      role: snapshot.planRole,
      total: snapshot.memberTotal,
      source: snapshot.planSource,
      highlightLine: snapshot.highlightLine,
      briefs: snapshot.briefs,
      slugs: snapshot.slugs,
    },
    doctor: snapshot.doctor,
    checks: snapshot.planFindings,
    run: snapshot.run,
    budget: snapshot.budget,
    violations: snapshot.violations,
    daemon: snapshot.daemon,
    chrome: snapshot.chrome,
  };
}
