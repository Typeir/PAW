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
 * @property {(event: DispatchEvent) => void | Promise<void>} [onProgress] - Told as each member starts and settles, so a watcher can show a run filling in, or persist it. Awaited when it returns a promise.
 * @property {number} [concurrency] - How many members may be in flight at once; defaults to {@link DEFAULT_CONCURRENCY}. Values below one are treated as one.
 * @property {number} [maxOutputTokens] - Per-run override of the bound model's output ceiling: every member's request carries this instead of the model's declared default. Undefined leaves each member on the model default. A caller collects it however it likes — a flag, a prompt, a selector — but the behaviour lives here so every surface caps a run the same way.
 */
export interface DispatchDeps<A> {
  readonly registry: RoleRegistry;
  readonly files: FileReaderPort;
  readonly skip?: (plan: SwarmPlan<A>, member: number) => boolean | Promise<boolean>;
  readonly alreadyDone?: (key: string) => boolean;
  readonly onProgress?: (event: DispatchEvent) => void | Promise<void>;
  readonly concurrency?: number;
  readonly maxOutputTokens?: number;
}

/**
 * How many members run at once when the caller does not say.
 *
 * A herd is a batch of independent requests to a provider that is happy to take
 * them together, so dispatching one at a time spends the whole run waiting on a
 * network round trip that nothing depends on. Bounded rather than unlimited
 * because a plan of four hundred members would otherwise open four hundred
 * connections and earn a rate limit instead of an answer.
 *
 * Concurrency belongs to the caller, not the plan: a plan declares what to ask,
 * and how hard to push a particular provider on a particular machine is not
 * something a plan file can know.
 */
export const DEFAULT_CONCURRENCY = 8;

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
 * It may return a promise, and the dispatcher awaits it before that member's
 * worker takes another. That is what lets a caller persist each result as it
 * lands: a long run that dies at member sixty keeps the fifty-nine already paid
 * for, which a listener that could only fire-and-forget could not promise.
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

  const total = memberCount(plan);
  const slots = Math.max(1, Math.min(deps.concurrency ?? DEFAULT_CONCURRENCY, total));
  const settled = new Array<MemberOutcome | undefined>(total);

  /**
   * Record a member's outcome and tell the watcher, so the two can never
   * disagree about what happened.
   *
   * Written at the member's index rather than appended: members finish out of
   * order once more than one is in flight, and a caller comparing outcomes to
   * its own list of inputs would silently pair the wrong tale with the wrong
   * file.
   *
   * @param {MemberOutcome} outcome - How the member finished.
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
   * @returns {Promise<void>} Settles when the member has.
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
    const res = await handle.port.complete({
      model: handle.modelId,
      prompt: await composeBrief(plan, member, deps.files),
      maxOutputTokens: deps.maxOutputTokens ?? handle.maxOutputTokens,
    });
    await settle({ member, key, state: 'done', content: res.content });
  };

  let next = 0;
  let failure: unknown = null;

  /**
   * Take members off the queue until they run out or one fails.
   *
   * The first failure stops new members being taken but does not abandon those
   * already in flight: they have been paid for, and a watcher writing from
   * `settled` events keeps them. The error is rethrown once the last worker is
   * done, so the run still fails loud per CONSTRAINTS.md Constraint 3 — it just
   * does not throw away work on the way out.
   *
   * @returns {Promise<void>} Settles when this worker stops.
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
