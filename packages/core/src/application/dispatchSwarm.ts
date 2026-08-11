/**
 * PAW Dispatch-Swarm Use-Case
 *
 * @fileoverview Run swarm plan. Validate it. Refuse release when doctor fail.
 * Resolve role to model through port. Then each member, apply resume and skip
 * before dispatch rendered brief. Compose swarm domain, role registry, and
 * {@link ModelPort} through interfaces. Fail loud per CONSTRAINTS.md Constraint 3:
 * plan that fail doctor not released (`released: false` result). Role that
 * resolve to no model throw.
 *
 * @module @paw/core/application/dispatchSwarm
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  composeSystemSections,
  doctorPlan,
  memberCount,
  planKey,
  toolsOf,
  type DoctorFinding,
  type SwarmPlan,
} from '../domain/swarm.js';
import type { FileReaderPort } from '../ports/index.js';
import { composeBrief } from './composeBrief.js';
import { resolveModel, type RoleRegistry } from './roleRegistry.js';

/**
 * Outcome for one member of dispatched swarm.
 *
 * @interface MemberOutcome
 * @property {number} member - Zero-based member index.
 * @property {string} key - Member resume key.
 * @property {'done' | 'skipped'} state - It run or skip (resume or skip predicate).
 * @property {string} [content] - Model content when member run.
 */
export interface MemberOutcome {
  readonly member: number;
  readonly key: string;
  readonly state: 'done' | 'skipped';
  readonly content?: string;
}

/**
 * Result of dispatching swarm.
 *
 * @interface DispatchResult
 * @property {boolean} released - False when doctor refuse plan.
 * @property {DoctorFinding[]} findings - Doctor findings, always populated.
 * @property {MemberOutcome[]} outcomes - One per member when released; empty when not.
 */
export interface DispatchResult {
  readonly released: boolean;
  readonly findings: DoctorFinding[];
  readonly outcomes: MemberOutcome[];
}

/**
 * What use-case need beyond the plan.
 *
 * @interface DispatchDeps
 * @property {RoleRegistry} registry - Role declarations and bindings. Resolve plan role to model.
 * @property {FileReaderPort} files - Read files member attach as context. Required. Caller decide how read files.
 * @property {(plan: SwarmPlan<A>, member: number) => (boolean | Promise<boolean>)} [skip] - Pre-dispatch filter. True skip member with no model call. May read files.
 * @property {(key: string) => boolean} [alreadyDone] - Resume predicate. True skip member whose key already complete.
 * @property {(event: DispatchEvent) => void | Promise<void>} [onProgress] - Called as each member start and settle. Awaited when return promise.
 * @property {number} [concurrency] - How many members in flight at once. Default {@link DEFAULT_CONCURRENCY}. Value below one treat as one.
 * @property {number} [maxOutputTokens] - Per-run override of bound model output ceiling. Every member request carry this. Undefined leave each member on model default.
 * @property {Readonly<Record<string, string>>} [systemBaseline] - Port slim system-prompt section defaults. Compose with each plan `system` override at dispatch. Undefined leave members on model own system prompt.
 */
export interface DispatchDeps<A> {
  readonly registry: RoleRegistry;
  readonly files: FileReaderPort;
  readonly skip?: (plan: SwarmPlan<A>, member: number) => boolean | Promise<boolean>;
  readonly alreadyDone?: (key: string) => boolean;
  readonly onProgress?: (event: DispatchEvent) => void | Promise<void>;
  readonly concurrency?: number;
  readonly maxOutputTokens?: number;
  readonly systemBaseline?: Readonly<Record<string, string>>;
}

/**
 * Default members in flight when caller not specify. Bounded to cap concurrent
 * connections to provider.
 */
export const DEFAULT_CONCURRENCY = 8;

/**
 * Member progress, emitted as it happen. Throwing listener not caught; error
 * propagate. May return promise. Dispatcher await it before that member worker
 * take another. Caller persist each result as it land.
 *
 * @interface DispatchEvent
 * @property {'started' | 'settled'} phase - Member beginning or have finished.
 * @property {number} member - Zero-based member index.
 * @property {string} key - Member resume key.
 * @property {number} total - How many members plan have.
 * @property {MemberOutcome} [outcome] - How it finish. Present only on `settled`.
 */
export interface DispatchEvent {
  readonly phase: 'started' | 'settled';
  readonly member: number;
  readonly key: string;
  readonly total: number;
  readonly outcome?: MemberOutcome;
}


/**
 * Dispatch swarm plan and collect each member outcome.
 *
 * @param {SwarmPlan<A>} plan - Plan to run.
 * @param {DispatchDeps<A>} deps - Registry and optional skip/resume predicates.
 * @returns {Promise<DispatchResult>} Release verdict, doctor findings, and member outcomes.
 * @throws {Error} When plan role resolve to no model.
 */
export async function dispatchSwarm<A>(
  plan: SwarmPlan<A>,
  deps: DispatchDeps<A>,
): Promise<DispatchResult> {
  const findings = doctorPlan(plan);
  if (findings.some((f) => !f.ok)) {
    return { released: false, findings, outcomes: [] };
  }

  const handle = resolveModel(deps.registry, plan.role);
  if (handle === null) {
    throw new Error(
      `swarm "${plan.name}" cannot run: role "${plan.role}" resolved to no model`,
    );
  }

  const total = memberCount(plan);
  const slots = Math.max(1, Math.min(deps.concurrency ?? DEFAULT_CONCURRENCY, total));
  const settled = new Array<MemberOutcome | undefined>(total);

  /**
   * Record member outcome and notify watcher. Write at member index; members
   * finish out of order once more than one in flight.
   *
   * @param {MemberOutcome} outcome - How member finish.
   */
  const settle = async (outcome: MemberOutcome): Promise<void> => {
    settled[outcome.member] = outcome;
    await deps.onProgress?.({
      phase: 'settled',
      member: outcome.member,
      key: outcome.key,
      total,
      outcome,
    });
  };

  /**
   * Run one member to its outcome.
   *
   * @param {number} member - Zero-based member index.
   * @returns {Promise<void>} Settle when member have.
   */
  const runMember = async (member: number): Promise<void> => {
    const key = planKey(plan, member);
    await deps.onProgress?.({ phase: 'started', member, key, total });

    if (deps.alreadyDone?.(key) === true) {
      await settle({ member, key, state: 'skipped' });
      return;
    }
    if (deps.skip && (await deps.skip(plan, member))) {
      await settle({ member, key, state: 'skipped' });
      return;
    }
    const tools = toolsOf(plan, member);
    const sections = composeSystemSections(plan, member, deps.systemBaseline ?? {});
    const res = await handle.port.complete({
      model: handle.modelId,
      prompt: await composeBrief(plan, member, deps.files),
      maxOutputTokens: deps.maxOutputTokens ?? handle.maxOutputTokens,
      ...(tools === undefined ? {} : { availableTools: tools }),
      ...(Object.keys(sections).length === 0 ? {} : { systemSections: sections }),
    });
    await settle({ member, key, state: 'done', content: res.content });
  };

  let next = 0;
  let failure: unknown = null;

  /**
   * Take members off queue until they run out or one fail. First failure stop
   * new members taken; those already in flight finish. Error rethrown once last
   * worker done. Fail loud per CONSTRAINTS.md Constraint 3.
   *
   * @returns {Promise<void>} Settle when worker stop.
   */
  const worker = async (): Promise<void> => {
    while (failure === null && next < total) {
      const member = next;
      next += 1;
      try {
        await runMember(member);
      } catch (err: unknown) {
        failure ??= err;
      }
    }
  };

  await Promise.all(Array.from({ length: slots }, () => worker()));

  if (failure !== null) {
    throw failure;
  }

  return {
    released: true,
    findings,
    outcomes: settled.filter((o): o is MemberOutcome => o !== undefined),
  };
}
