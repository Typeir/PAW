/**
 * PAW Console Snapshot Hydration
 *
 * @fileoverview Anti-corruption layer 'tween wire and console. It map `@paw/core`'s {@link PawSnapshot} — plain, JSON-safe shape `pawd` serve at `/api/state` — into module own {@link ConsoleData}. It enforce contract at boundary: snapshot whose brief and slug arrays disagree with own member count be producer defect, and this throw.
 *
 * @module @paw/gui/application/hydrateSnapshot
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { PawSnapshot } from '@paw/core';
import type { ConsoleData } from '../domain/console.types.js';

/**
 * Assert pre-rendered per-member array cover every member.
 *
 * @param {readonly string[]} values - Array producer send.
 * @param {number} total - Member count producer declare.
 * @param {string} what - What array hold, for error message.
 */
function assertCovers(values: readonly string[], total: number, what: string): void {
  if (values.length !== total) {
    throw new Error(
      `PAW console: snapshot declares ${total} members but sent ${values.length} ${what}`,
    );
  }
}

/**
 * Map wire snapshot to console data.
 *
 * @param {PawSnapshot} snapshot - Snapshot as served by `pawd`.
 * @returns {ConsoleData} Console's view of it.
 */
export function hydrate(snapshot: PawSnapshot): ConsoleData {
  assertCovers(snapshot.briefs, snapshot.memberTotal, 'briefs');
  assertCovers(snapshot.slugs, snapshot.memberTotal, 'slugs');
  return {
    host: snapshot.host,
    processes: snapshot.processes,
    root: snapshot.root,
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
