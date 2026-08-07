/**
 * PAW Dispatch-Swarm Use-Case
 *
 * @fileoverview Runs a swarm plan: validate it (refuse release if the doctor
 * fails), resolve its role to a model through the port, then for each member
 * apply resume and skip before dispatching the rendered brief. This is where the
 * pieces meet — the swarm domain, the role registry, and a {@link ModelPort} —
 * and it meets them through interfaces only, so whichever provider backs the
 * model is immaterial here. Fails loud per CONSTRAINTS.md Constraint 3: a plan
 * that fails the doctor is not released (a visible `released: false` result), and
 * a role that resolves to no model throws rather than silently running nothing.
 *
 * @module @paw/core/application/dispatchSwarm
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  doctorPlan,
  memberCount,
  planKey,
  type DoctorFinding,
  type SwarmPlan,
} from '../domain/swarm.js';
import type { FileReaderPort } from '../ports/index.js';
import { composeBrief } from './composeBrief.js';
import { resolveModel, type RoleRegistry } from './roleRegistry.js';

/**
 * The outcome for one member of a dispatched swarm.
 *
 * @interface MemberOutcome
 * @property {number} member - Zero-based member index.
 * @property {string} key - The member's resume key.
 * @property {'done' | 'skipped'} state - Whether it ran or was skipped (resume or the skip predicate).
 * @property {string} [content] - The model's content when the member ran.
 */
export interface MemberOutcome {
  readonly member: number;
  readonly key: string;
  readonly state: 'done' | 'skipped';
  readonly content?: string;
}

/**
 * The result of dispatching a swarm.
 *
 * @interface DispatchResult
 * @property {boolean} released - False when the doctor refused the plan.
 * @property {DoctorFinding[]} findings - The doctor findings, always populated.
 * @property {MemberOutcome[]} outcomes - One per member when released; empty when not.
 */
export interface DispatchResult {
  readonly released: boolean;
  readonly findings: DoctorFinding[];
  readonly outcomes: MemberOutcome[];
}

/**
 * What the use-case needs beyond the plan.
 *
 * @interface DispatchDeps
 * @property {RoleRegistry} registry - Role declarations and bindings, to resolve the plan's role to a model.
 * @property {FileReaderPort} files - Reads the files a member attaches as context. Required, so the caller always decides how files are read rather than the use-case guessing.
 * @property {(plan: SwarmPlan<A>, member: number) => (boolean | Promise<boolean>)} [skip] - Pre-dispatch filter; true skips the member with no model call. May read files.
 * @property {(key: string) => boolean} [alreadyDone] - Resume predicate; true skips a member whose key already completed.
 * @property {(event: DispatchEvent) => void} [onProgress] - Told as each member starts and settles, so a watcher can show a run filling in.
 */
export interface DispatchDeps<A> {
  readonly registry: RoleRegistry;
  readonly files: FileReaderPort;
  readonly skip?: (plan: SwarmPlan<A>, member: number) => boolean | Promise<boolean>;
  readonly alreadyDone?: (key: string) => boolean;
  readonly onProgress?: (event: DispatchEvent) => void;
}

/**
 * What a member is doing, as it happens.
 *
 * Emitted rather than returned because a run of four hundred members against a
 * real provider takes minutes, and a console that shows nothing until the last
 * one lands is indistinguishable from a console that has hung. The use-case
 * stays synchronous in spirit — it tells, it does not ask — so a caller that
 * wants nothing still gets the same {@link DispatchResult}.
 *
 * A listener that throws is not caught here: a use-case cannot decide what a
 * broken observer means, and swallowing it would hide the break.
 *
 * @interface DispatchEvent
 * @property {'started' | 'settled'} phase - Whether the member is beginning or has finished.
 * @property {number} member - Zero-based member index.
 * @property {string} key - The member's resume key.
 * @property {number} total - How many members the plan has.
 * @property {MemberOutcome} [outcome] - How it finished; present only on `settled`.
 */
export interface DispatchEvent {
  readonly phase: 'started' | 'settled';
  readonly member: number;
  readonly key: string;
  readonly total: number;
  readonly outcome?: MemberOutcome;
}


/**
 * Dispatch a swarm plan and collect each member's outcome.
 *
 * @param {SwarmPlan<A>} plan - The plan to run.
 * @param {DispatchDeps<A>} deps - The registry and optional skip/resume predicates.
 * @returns {Promise<DispatchResult>} The release verdict, doctor findings, and member outcomes.
 * @throws {Error} When the plan's role resolves to no model — a swarm cannot run without one.
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

  const outcomes: MemberOutcome[] = [];
  const total = memberCount(plan);

  /**
   * Record a member's outcome and tell the watcher, so the two can never
   * disagree about what happened.
   *
   * @param {MemberOutcome} outcome - How the member finished.
   */
  const settle = (outcome: MemberOutcome): void => {
    outcomes.push(outcome);
    deps.onProgress?.({
      phase: 'settled',
      member: outcome.member,
      key: outcome.key,
      total,
      outcome,
    });
  };

  for (let member = 0; member < total; member += 1) {
    const key = planKey(plan, member);
    deps.onProgress?.({ phase: 'started', member, key, total });

    if (deps.alreadyDone?.(key) === true) {
      settle({ member, key, state: 'skipped' });
      continue;
    }
    if (deps.skip && (await deps.skip(plan, member))) {
      settle({ member, key, state: 'skipped' });
      continue;
    }
    const res = await handle.port.complete({
      model: handle.modelId,
      prompt: await composeBrief(plan, member, deps.files),
    });
    settle({ member, key, state: 'done', content: res.content });
  }

  return { released: true, findings, outcomes };
}
