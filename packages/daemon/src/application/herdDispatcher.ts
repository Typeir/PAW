/**
 * Herd Dispatcher
 *
 * @fileoverview The one place a run is built from settings — the engine both the
 * CLI's `paw ui` and the daemon's release handler share, so a run behaves the same
 * whichever face configured it. Given {@link RunSettings} and injected
 * collaborators, it returns a dispatcher that opens the right registry (a live
 * provider or the deterministic fake), meters the bound port so the console's
 * spend is a count and not an estimate, attaches the run's context to the plan,
 * forwards its output ceiling and concurrency to dispatch, writes each member as
 * it lands, and always closes the live client. The collaborators are injected
 * because they live in different packages — `openLive` and the writer differ
 * between a CLI process and the daemon — but the orchestration is one, and it is
 * covered here once rather than hand-rolled per surface.
 *
 * @module @paw/daemon/application/herdDispatcher
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type {
  BudgetSummary,
  DispatchDeps,
  DispatchEvent,
  DispatchResult,
  FileReaderPort,
  RoleRegistry,
  RunSettings,
  SwarmPlan,
} from '@paw/core';
import { meterPort } from '../run.js';

/**
 * The slice of a herd writer the engine drives — each settled member is written
 * as it lands, so the output exists whether or not the run finishes.
 *
 * @interface HerdWriterLike
 * @property {(event: DispatchEvent) => Promise<void>} onProgress - Write on each settle.
 * @property {() => string[]} written - Paths written so far.
 */
export interface HerdWriterLike {
  onProgress(event: DispatchEvent): Promise<void>;
  written(): string[];
}

/**
 * The collaborators {@link dispatcherFor} needs, injected so the engine is pure
 * and package-agnostic.
 *
 * @interface HerdDeps
 * @property {(plan: SwarmPlan<unknown>) => Promise<{ registry: RoleRegistry; close: () => Promise<void> }>} openLive - Open a live registry and a hook that stops its client.
 * @property {(plan: SwarmPlan<unknown>) => RoleRegistry} fakeRegistry - The deterministic registry for a non-live run.
 * @property {(plan: SwarmPlan<unknown>, paths: readonly string[]) => SwarmPlan<unknown>} withContext - Attach resolved context files to every brief.
 * @property {(globs: readonly string[]) => Promise<readonly string[]>} resolveContext - Resolve the run's context globs to file contents.
 * @property {FileReaderPort} files - Reads the files a member attaches.
 * @property {(plan: SwarmPlan<unknown>) => HerdWriterLike} makeWriter - Build the writer for this plan's output.
 * @property {(plan: SwarmPlan<unknown>, deps: DispatchDeps<unknown>) => Promise<DispatchResult>} dispatch - The dispatch use-case, injected so this stays a unit.
 */
export interface HerdDeps {
  openLive: (plan: SwarmPlan<unknown>) => Promise<{ registry: RoleRegistry; close: () => Promise<void> }>;
  fakeRegistry: (plan: SwarmPlan<unknown>) => RoleRegistry;
  withContext: (plan: SwarmPlan<unknown>, paths: readonly string[]) => SwarmPlan<unknown>;
  resolveContext: (globs: readonly string[]) => Promise<readonly string[]>;
  files: FileReaderPort;
  makeWriter: (plan: SwarmPlan<unknown>) => HerdWriterLike;
  dispatch: (plan: SwarmPlan<unknown>, deps: DispatchDeps<unknown>) => Promise<DispatchResult>;
}

/**
 * A run, reported live: the dispatch result and the metered usage. Structurally a
 * daemon `Dispatcher`, so it slots into the existing release path without either
 * knowing the other.
 */
export type HerdDispatcher = (
  plan: SwarmPlan<unknown>,
  onProgress: (event: DispatchEvent) => void | Promise<void>,
) => Promise<{ result: DispatchResult; usage: BudgetSummary }>;

/**
 * Build the dispatcher a run's settings describe.
 *
 * @param {RunSettings} settings - What to run and how.
 * @param {HerdDeps} deps - The injected collaborators.
 * @returns {HerdDispatcher} The dispatcher, ready for the release path to run and report.
 */
export function dispatcherFor(settings: RunSettings, deps: HerdDeps): HerdDispatcher {
  return async (plan, onProgress) => {
    const opened = settings.live
      ? await deps.openLive(plan)
      : { registry: deps.fakeRegistry(plan), close: async (): Promise<void> => undefined };
    try {
      const binding = opened.registry.bindings.get(plan.role);
      if (binding === undefined) {
        throw new Error(`cannot run "${plan.name}": role "${plan.role}" is bound to no model`);
      }
      const metered = meterPort(binding.port);
      const bindings = new Map(opened.registry.bindings);
      bindings.set(plan.role, { ...binding, port: metered.port });
      const attached = settings.context === undefined ? [] : await deps.resolveContext(settings.context);
      const writer = deps.makeWriter(plan);
      const result = await deps.dispatch(deps.withContext(plan, attached), {
        registry: { declarations: opened.registry.declarations, bindings },
        files: deps.files,
        ...(settings.concurrency === undefined ? {} : { concurrency: settings.concurrency }),
        ...(settings.maxOutputTokens === undefined ? {} : { maxOutputTokens: settings.maxOutputTokens }),
        onProgress: async (event) => {
          await onProgress(event);
          await writer.onProgress(event);
        },
      });
      return { result, usage: metered.usage() };
    } finally {
      await opened.close();
    }
  };
}
