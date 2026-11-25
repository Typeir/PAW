/**
 * Herd Dispatcher
 *
 * @fileoverview Build run from settings. Engine both CLI `paw ui` and daemon
 * release handler share. With {@link RunSettings} plus injected collaborators,
 * return dispatcher that open registry (live provider or deterministic fake),
 * meter bound port, attach run context to plan, forward output ceiling and
 * concurrency to dispatch, write each member when it land, close live client.
 * Every run is proved against the plan's `expectFiles` (live runs pre-create
 * missing targets); a live run held to gates also judges open violations in
 * those files.
 *
 * @module @paw/daemon/application/herdDispatcher
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  judgeViolations,
  openTargetLedger,
  type BudgetSummary,
  type DispatchDeps,
  type DispatchEvent,
  type DispatchResult,
  type FileReaderPort,
  type FileSystemPort,
  type MemberProof,
  type RoleRegistry,
  type RunSettings,
  type SwarmPlan,
  type Violation,
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
 * @property {(plan: SwarmPlan<unknown>, gates: boolean) => Promise<{ registry: RoleRegistry; close: () => Promise<void> }>} openLive - Open live registry plus hook that stop its client; `gates` false runs members with no gates.
 * @property {(plan: SwarmPlan<unknown>) => RoleRegistry} fakeRegistry - Deterministic registry for non-live run.
 * @property {(plan: SwarmPlan<unknown>, paths: readonly string[]) => SwarmPlan<unknown>} withContext - Attach resolved context files to every brief.
 * @property {(globs: readonly string[]) => Promise<readonly string[]>} resolveContext - Turn run context globs to file contents.
 * @property {FileReaderPort} files - Read files member attach.
 * @property {(plan: SwarmPlan<unknown>) => HerdWriterLike} makeWriter - Build writer for this plan output.
 * @property {(plan: SwarmPlan<unknown>, deps: DispatchDeps<unknown>) => Promise<DispatchResult>} dispatch - Dispatch use-case.
 * @property {FileSystemPort} fs - Where declared target files live; read before and after the run.
 * @property {() => Promise<readonly Violation[] | null>} violations - Open violations of the repository's enforcement pawd; null when none answers.
 */
export interface HerdDeps {
  openLive: (
    plan: SwarmPlan<unknown>,
    gates: boolean,
  ) => Promise<{ registry: RoleRegistry; close: () => Promise<void> }>;
  fakeRegistry: (plan: SwarmPlan<unknown>) => RoleRegistry;
  withContext: (plan: SwarmPlan<unknown>, paths: readonly string[]) => SwarmPlan<unknown>;
  resolveContext: (globs: readonly string[]) => Promise<readonly string[]>;
  files: FileReaderPort;
  makeWriter: (plan: SwarmPlan<unknown>) => HerdWriterLike;
  dispatch: (plan: SwarmPlan<unknown>, deps: DispatchDeps<unknown>) => Promise<DispatchResult>;
  fs: FileSystemPort;
  violations: () => Promise<readonly Violation[] | null>;
}

/**
 * Run, report live: dispatch result, metered usage, and per-member proof. Structurally daemon
 * `Dispatcher`.
 */
export type HerdDispatcher = (
  plan: SwarmPlan<unknown>,
  onProgress: (event: DispatchEvent) => void | Promise<void>,
) => Promise<{ result: DispatchResult; usage: BudgetSummary; proofs: readonly MemberProof[] }>;

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
      ? await deps.openLive(plan, settings.gates ?? true)
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
      const ledger = openTargetLedger(plan, deps.fs);
      await ledger.snapshot();
      if (settings.live) {
        await ledger.createPlaceholders();
      }
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
      const proofs = await ledger.prove(result.outcomes, writer.written());
      const policed = settings.live && (settings.gates ?? true);
      return {
        result,
        usage: metered.usage(),
        proofs: policed ? judgeViolations(proofs, (await deps.violations()) ?? []) : proofs,
      };
    } finally {
      await opened.close();
    }
  };
}
