/**
 * Herd Dispatcher
 *
 * @fileoverview Build run from settings. Engine both CLI `paw ui` and daemon
 * release handler share. With {@link RunSettings} plus injected collaborators,
 * return dispatcher that open registry (live provider or deterministic fake),
 * meter bound port, attach run context to plan, forward output ceiling and
 * concurrency to dispatch, write each member when it land, close live client.
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
import { meterPort } from './run.js';

/**
 * Slice of herd writer engine drive. Write each settle member when it land.
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
 * Collaborators {@link dispatcherFor} want.
 *
 * @interface HerdDeps
 * @property {(plan: SwarmPlan<unknown>) => Promise<{ registry: RoleRegistry; close: () => Promise<void> }>} openLive - Open live registry plus hook that stop its client.
 * @property {(plan: SwarmPlan<unknown>) => RoleRegistry} fakeRegistry - Deterministic registry for non-live run.
 * @property {(plan: SwarmPlan<unknown>, paths: readonly string[]) => SwarmPlan<unknown>} withContext - Attach resolved context files to every brief.
 * @property {(globs: readonly string[]) => Promise<readonly string[]>} resolveContext - Turn run context globs to file contents.
 * @property {FileReaderPort} files - Read files member attach.
 * @property {(plan: SwarmPlan<unknown>) => HerdWriterLike} makeWriter - Build writer for this plan output.
 * @property {(plan: SwarmPlan<unknown>, deps: DispatchDeps<unknown>) => Promise<DispatchResult>} dispatch - Dispatch use-case.
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
 * Run, report live: dispatch result plus metered usage. Structurally daemon
 * `Dispatcher`.
 */
export type HerdDispatcher = (
  plan: SwarmPlan<unknown>,
  onProgress: (event: DispatchEvent) => void | Promise<void>,
) => Promise<{ result: DispatchResult; usage: BudgetSummary }>;

/**
 * Build dispatcher run settings describe.
 *
 * @param {RunSettings} settings - What to run and how.
 * @param {HerdDeps} deps - Injected collaborators.
 * @returns {HerdDispatcher} Dispatcher, ready for release path to run and report.
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
