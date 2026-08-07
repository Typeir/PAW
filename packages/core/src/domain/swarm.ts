/**
 * PAW Swarm Briefing Domain
 *
 * @fileoverview The swarm plan and the pure operations over it — the briefing
 * mechanism from decision doc 16. A plan's `brief(args, member)` is the whole
 * per-member prompting story: an eight-way conditional is just a function, which
 * is why a plan is code, not a template format. This module holds only the pure
 * parts — resolving the member count, rendering a brief, deriving a resume key
 * and a member's target files, and the `doctor` validation that refuses a broken
 * plan before a single token is spent. The `skip` predicate may read files, so
 * it is an application concern, not part of this pure domain.
 *
 * @module @paw/core/domain/swarm
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * A swarm plan: everything needed to release a herd, authored as code so `args`
 * can be computed from any source and `brief` can interpolate freely.
 *
 * @interface SwarmPlan
 * @property {string} name - Stable identifier; names the pen directory and manifest.
 * @property {string} role - Role id the bound model must satisfy before release.
 * @property {A} args - The arglist; anything. Frozen into the manifest at release.
 * @property {number | ((args: A) => number)} members - Member count, or a function of args returning it. Members are 0-indexed.
 * @property {(args: A, member: number, members: number) => string} brief - Produces the full prompt for one member. Pure.
 * @property {(args: A, member: number) => (string | string[])} [expectFiles] - The file(s) a member is expected to write; enables the file-conflict check.
 * @property {(args: A, member: number) => (boolean | Promise<boolean>)} [skip] - Cheap predicate run before dispatch; true skips the member with no model call. May read files, so it is applied by the application, not the doctor.
 * @property {(args: A, member: number) => readonly string[]} [contextFiles] - Files whose contents are attached to the member's brief at dispatch. Declares paths only — pure, like `expectFiles`; the reading is an application concern behind a port.
 * @property {(args: A, member: number) => string} [key] - Stable per-member identity for idempotent resume; defaults to the member index.
 * @property {string[]} [tools] - Optional per-member tool allow-list overriding the role default.
 */
export interface SwarmPlan<A = unknown> {
  readonly name: string;
  readonly role: string;
  readonly args: A;
  readonly members: number | ((args: A) => number);
  readonly brief: (args: A, member: number, members: number) => string;
  readonly expectFiles?: (args: A, member: number) => string | string[];
  readonly skip?: (args: A, member: number) => boolean | Promise<boolean>;
  readonly contextFiles?: (args: A, member: number) => readonly string[];
  readonly key?: (args: A, member: number) => string;
  readonly tools?: readonly string[];
}

/**
 * A single validation finding from {@link doctorPlan}.
 *
 * @interface DoctorFinding
 * @property {string} check - The check's name.
 * @property {boolean} ok - Whether it passed.
 * @property {string} [detail] - Why it failed, when it did.
 */
export interface DoctorFinding {
  readonly check: string;
  readonly ok: boolean;
  readonly detail?: string;
}

/**
 * Resolve a plan's member count.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @returns {number} The number of members.
 */
export function memberCount<A>(plan: SwarmPlan<A>): number {
  return typeof plan.members === 'function'
    ? plan.members(plan.args)
    : plan.members;
}

/**
 * Render the frozen brief for one member.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number} member - Zero-based member index.
 * @returns {string} The member's prompt.
 */
export function renderBrief<A>(plan: SwarmPlan<A>, member: number): string {
  return plan.brief(plan.args, member, memberCount(plan));
}

/**
 * The stable resume key for one member — the plan's `key` when present, else the
 * member index as a string.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number} member - Zero-based member index.
 * @returns {string} The resume key.
 */
export function planKey<A>(plan: SwarmPlan<A>, member: number): string {
  return plan.key ? plan.key(plan.args, member) : String(member);
}

/**
 * The file(s) a member is expected to write, normalised to an array (empty when
 * the plan declares no `expectFiles`).
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number} member - Zero-based member index.
 * @returns {string[]} The member's target files.
 */
export function targetsOf<A>(plan: SwarmPlan<A>, member: number): string[] {
  if (!plan.expectFiles) {
    return [];
  }
  const out = plan.expectFiles(plan.args, member);
  return Array.isArray(out) ? [...out] : [out];
}

/**
 * The files a member attaches to its brief as context (empty when the plan
 * declares no `contextFiles`). Declaration only — nothing is read here; the
 * pure domain never touches a filesystem.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number} member - Zero-based member index.
 * @returns {string[]} The member's context paths.
 */
export function contextOf<A>(plan: SwarmPlan<A>, member: number): string[] {
  return plan.contextFiles ? [...plan.contextFiles(plan.args, member)] : [];
}

/**
 * The zero-based member indices of a plan.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @returns {number[]} `[0, 1, …, count-1]`.
 */
function memberIndices<A>(plan: SwarmPlan<A>): number[] {
  return Array.from({ length: memberCount(plan) }, (_v, m) => m);
}

/**
 * Check that the member count is a positive integer.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @returns {DoctorFinding} The count finding.
 */
function checkCount<A>(plan: SwarmPlan<A>): DoctorFinding {
  const n = memberCount(plan);
  const ok = Number.isInteger(n) && n > 0;
  return ok
    ? { check: 'count', ok }
    : { check: 'count', ok, detail: `member count is ${n}, expected a positive integer` };
}

/**
 * Check that every member's brief renders to a non-empty string without
 * throwing — the check that catches the off-by-one that only bites the last
 * member.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number[]} members - The member indices.
 * @returns {DoctorFinding} The total-brief finding.
 */
function checkTotalBrief<A>(
  plan: SwarmPlan<A>,
  members: number[],
): DoctorFinding {
  for (const m of members) {
    let text: string;
    try {
      text = renderBrief(plan, m);
    } catch (err) {
      return {
        check: 'total-brief',
        ok: false,
        detail: `member ${m} threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (text.length === 0) {
      return { check: 'total-brief', ok: false, detail: `member ${m} rendered an empty brief` };
    }
  }
  return { check: 'total-brief', ok: true };
}

/**
 * Check that a sample of members render the same brief twice — a cheap guard
 * that `brief` is pure and thus reproducible at release and at validation.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number[]} members - The member indices.
 * @returns {DoctorFinding} The purity finding.
 */
function checkPurity<A>(plan: SwarmPlan<A>, members: number[]): DoctorFinding {
  const sample = [members[0], members[members.length - 1]];
  for (const m of sample) {
    if (renderBrief(plan, m) !== renderBrief(plan, m)) {
      return { check: 'purity', ok: false, detail: `member ${m} rendered differently across two calls` };
    }
  }
  return { check: 'purity', ok: true };
}

/**
 * Check that no two members target the same file — two members editing one file
 * is a write race the release must refuse. Skipped when the plan declares no
 * `expectFiles`.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number[]} members - The member indices.
 * @returns {DoctorFinding} The file-conflict finding.
 */
function checkFileConflict<A>(
  plan: SwarmPlan<A>,
  members: number[],
): DoctorFinding {
  if (!plan.expectFiles) {
    return { check: 'file-conflict', ok: true, detail: 'no expectFiles declared' };
  }
  const seen = new Set<string>();
  for (const m of members) {
    for (const file of targetsOf(plan, m)) {
      if (seen.has(file)) {
        return { check: 'file-conflict', ok: false, detail: `two members target ${file}` };
      }
      seen.add(file);
    }
  }
  return { check: 'file-conflict', ok: true };
}

/**
 * Check that no two members share a resume key.
 *
 * A key is a member's identity across runs: `alreadyDone(key)` is the whole
 * resume mechanism, and a duplicate makes it answer for the wrong member. The
 * failure is silent and asymmetric — the first member with a given key runs, and
 * every later member sharing it is reported `skipped`, which reads exactly like
 * a legitimate resume. A plan that derives keys from a filename will collide the
 * moment two of its inputs are named alike in different directories, and nothing
 * downstream can tell that apart from work already done.
 *
 * This is the resume-dimension twin of {@link checkFileConflict}: that one
 * refuses two members writing one file, this one refuses two members *being* the
 * same member.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number[]} members - The member indices.
 * @returns {DoctorFinding} The key-collision finding.
 */
function checkKeyCollision<A>(
  plan: SwarmPlan<A>,
  members: number[],
): DoctorFinding {
  const seen = new Map<string, number>();
  for (const m of members) {
    const key = planKey(plan, m);
    const first = seen.get(key);
    if (first !== undefined) {
      return {
        check: 'key-collision',
        ok: false,
        detail: `members ${first} and ${m} share the resume key "${key}"`,
      };
    }
    seen.set(key, m);
  }
  return { check: 'key-collision', ok: true };
}

/**
 * Check that every path a member attaches as context is a real path — a
 * non-empty string. Existence cannot be checked here (the domain reads no
 * filesystem), but a plan that computes a blank or missing path is a defect
 * worth catching before the first member is dispatched rather than after the
 * tokens for the members ahead of it are already spent.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number[]} members - The member indices.
 * @returns {DoctorFinding} The context-paths finding.
 */
function checkContextPaths<A>(
  plan: SwarmPlan<A>,
  members: number[],
): DoctorFinding {
  if (!plan.contextFiles) {
    return { check: 'context-paths', ok: true, detail: 'no contextFiles declared' };
  }
  for (const m of members) {
    for (const path of contextOf(plan, m)) {
      if (typeof path !== 'string' || path.length === 0) {
        return {
          check: 'context-paths',
          ok: false,
          detail: `member ${m} attaches an empty context path`,
        };
      }
    }
  }
  return { check: 'context-paths', ok: true };
}

/**
 * Validate a plan before release. Returns one finding per check; a release is
 * refused when any finding is not ok.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @returns {DoctorFinding[]} The findings, in check order.
 */
export function doctorPlan<A>(plan: SwarmPlan<A>): DoctorFinding[] {
  const count = checkCount(plan);
  if (!count.ok) {
    return [count];
  }
  const members = memberIndices(plan);
  const totalBrief = checkTotalBrief(plan, members);
  if (!totalBrief.ok) {
    return [count, totalBrief];
  }
  return [
    count,
    totalBrief,
    checkPurity(plan, members),
    checkFileConflict(plan, members),
    checkKeyCollision(plan, members),
    checkContextPaths(plan, members),
  ];
}
