/**
 * PAW Swarm Briefing Domain
 *
 * @fileoverview Swarm plan and pure operations over it — briefing mechanism from decision doc 16. Plan `brief(args, member)` make per-member prompt; plan is code. This module hold pure parts: resolve member count, render brief, derive resume key and member target files, and `doctor` validation that refuse broken plan before dispatch. `skip` predicate may read files; that application concern.
 *
 * @module @paw/core/domain/swarm
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Swarm plan: everything needed to dispatch members, authored as code.
 *
 * @interface SwarmPlan
 * @property {string} name - Stable identifier; name pen directory and manifest.
 * @property {string} role - Role id bound model must satisfy before release.
 * @property {A} args - Arglist; anything. Frozen into manifest at release.
 * @property {number | ((args: A) => number)} members - Member count, or function of args return it. Members 0-indexed.
 * @property {(args: A, member: number, members: number) => string} brief - Produce full prompt for one member. Pure.
 * @property {(args: A, member: number) => (string | string[])} [expectFiles] - File(s) member expected to write; enable file-conflict check.
 * @property {(args: A, member: number) => (boolean | Promise<boolean>)} [skip] - Cheap predicate run before dispatch; true skip member with no model call. May read files; application apply it.
 * @property {(args: A, member: number) => readonly string[]} [contextFiles] - Files whose contents attach to member brief at dispatch. Declare paths only; reading application concern behind port.
 * @property {(args: A, member: number) => string} [key] - Stable per-member identity for idempotent resume; default to member index.
 * @property {(args: A, member: number) => string | undefined} [model] - Per-member model id. String override the role-bound model for that member; undefined fall back to it. Pure; run at dispatch.
 * @property {readonly string[]} [availableTools] - Canonical tool names grant to every member, override role default. SDK-agnostic; each model port map them to own tool names.
 * @property {(args: A, member: number) => readonly string[]} [resolveTools] - Per-member canonical tool names, override `availableTools` and role default. Run at dispatch.
 * @property {(sections: Readonly<Record<string, string>>, args: A, member: number) => Readonly<Record<string, string | undefined>>} [system] - Compose member system prompt from port slim baseline. Get baseline sections; return override per id. String → replace; `undefined` → drop to model default; id left out → keep baseline. SDK-agnostic; port map resolved section to system-message.
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
  readonly model?: (args: A, member: number) => string | undefined;
  readonly availableTools?: readonly string[];
  readonly resolveTools?: (args: A, member: number) => readonly string[];
  readonly system?: (
    sections: Readonly<Record<string, string>>,
    args: A,
    member: number,
  ) => Readonly<Record<string, string | undefined>>;
}

/**
 * Single validation finding from {@link doctorPlan}.
 *
 * @interface DoctorFinding
 * @property {string} check - Check name.
 * @property {boolean} ok - Whether it pass.
 * @property {string} [detail] - Why it fail, when it fail.
 */
export interface DoctorFinding {
  readonly check: string;
  readonly ok: boolean;
  readonly detail?: string;
}

/**
 * Resolve plan member count.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @returns {number} Number of members.
 */
export function memberCount<A>(plan: SwarmPlan<A>): number {
  return typeof plan.members === 'function'
    ? plan.members(plan.args)
    : plan.members;
}

/**
 * Render frozen brief for one member.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number} member - Zero-based member index.
 * @returns {string} Member prompt.
 */
export function renderBrief<A>(plan: SwarmPlan<A>, member: number): string {
  return plan.brief(plan.args, member, memberCount(plan));
}

/**
 * Stable resume key for one member — plan `key` when present, else member
 * index as string.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number} member - Zero-based member index.
 * @returns {string} Resume key.
 */
export function planKey<A>(plan: SwarmPlan<A>, member: number): string {
  return plan.key ? plan.key(plan.args, member) : String(member);
}

/**
 * File(s) a member expected to write, normalised to array (empty when plan
 * declare no `expectFiles`).
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number} member - Zero-based member index.
 * @returns {string[]} Member target files.
 */
export function targetsOf<A>(plan: SwarmPlan<A>, member: number): string[] {
  if (!plan.expectFiles) {
    return [];
  }
  const out = plan.expectFiles(plan.args, member);
  return Array.isArray(out) ? [...out] : [out];
}

/**
 * Files a member attach to brief as context (empty when plan declare no
 * `contextFiles`). Declaration only; nothing read here.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number} member - Zero-based member index.
 * @returns {string[]} Member context paths.
 */
export function contextOf<A>(plan: SwarmPlan<A>, member: number): string[] {
  return plan.contextFiles ? [...plan.contextFiles(plan.args, member)] : [];
}

/**
 * Model id one member run with, or undefined for the role-bound default.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number} member - Zero-based member index.
 * @returns {string | undefined} Override model id, or undefined.
 */
export function modelOf<A>(plan: SwarmPlan<A>, member: number): string | undefined {
  return plan.model ? plan.model(plan.args, member) : undefined;
}

/**
 * Canonical tool names one member granted: `resolveTools` when present, else
 * `availableTools`, else undefined — model port fall back to role default.
 * Names SDK-agnostic; each port map them to own tool names.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number} member - Zero-based member index.
 * @returns {readonly string[] | undefined} Member canonical tools, or undefined for role default.
 */
export function toolsOf<A>(plan: SwarmPlan<A>, member: number): readonly string[] | undefined {
  if (plan.resolveTools) {
    return plan.resolveTools(plan.args, member);
  }
  return plan.availableTools;
}

/**
 * System-prompt sections one member run with: port slim `baseline` + plan
 * `system` override. Override string → replace; override `undefined` → drop
 * (model keep own default); left out → keep baseline. Section id opaque here;
 * port map resolved section to system-message. Empty when no baseline and no
 * `system`.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number} member - Zero-based member index.
 * @param {Readonly<Record<string, string>>} baseline - Port slim section defaults.
 * @returns {Record<string, string>} Resolved sections, undefined-valued dropped.
 */
export function composeSystemSections<A>(
  plan: SwarmPlan<A>,
  member: number,
  baseline: Readonly<Record<string, string>>,
): Record<string, string> {
  const overrides = plan.system ? plan.system(baseline, plan.args, member) : {};
  const resolved: Record<string, string> = {};
  for (const [id, content] of Object.entries({ ...baseline, ...overrides })) {
    if (typeof content === 'string') {
      resolved[id] = content;
    }
  }
  return resolved;
}

/**
 * Zero-based member indices of plan.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @returns {number[]} `[0, 1, …, count-1]`.
 */
function memberIndices<A>(plan: SwarmPlan<A>): number[] {
  return Array.from({ length: memberCount(plan) }, (_v, m) => m);
}

/**
 * Check member count is positive integer.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @returns {DoctorFinding} Count finding.
 */
function checkCount<A>(plan: SwarmPlan<A>): DoctorFinding {
  const n = memberCount(plan);
  const ok = Number.isInteger(n) && n > 0;
  return ok
    ? { check: 'count', ok }
    : { check: 'count', ok, detail: `member count is ${n}, expected a positive integer` };
}

/**
 * Check every member brief render to non-empty string without throw.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number[]} members - Member indices.
 * @returns {DoctorFinding} Total-brief finding.
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
 * Check sample of members render same brief twice, confirm `brief` pure.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number[]} members - Member indices.
 * @returns {DoctorFinding} Purity finding.
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
 * Check no two members target same file. Skip when plan declare no
 * `expectFiles`.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number[]} members - Member indices.
 * @returns {DoctorFinding} File-conflict finding.
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
 * Check no two members share resume key.
 *
 * Key is member identity across runs; `alreadyDone(key)` is resume mechanism,
 * duplicate make it answer for wrong member. Failure silent: first member with
 * given key run, every later member share it reported `skipped`. Same
 * conflict check as {@link checkFileConflict}, over resume keys.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number[]} members - Member indices.
 * @returns {DoctorFinding} Key-collision finding.
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
 * Check every path a member attach as context is non-empty string. Existence
 * not checked here; domain read no filesystem.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number[]} members - Member indices.
 * @returns {DoctorFinding} Context-paths finding.
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
 * Check `model`, when declared, resolve every member to a non-empty string or
 * undefined without throw. Whether a returned id is configured is the
 * registry's concern; the plan check is shape only.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number[]} members - Member indices.
 * @returns {DoctorFinding} Model-resolution finding.
 */
function checkModelResolution<A>(
  plan: SwarmPlan<A>,
  members: number[],
): DoctorFinding {
  if (!plan.model) {
    return { check: 'model-resolution', ok: true, detail: 'no model resolutor declared' };
  }
  for (const m of members) {
    let id: string | undefined;
    try {
      id = modelOf(plan, m);
    } catch (err) {
      return {
        check: 'model-resolution',
        ok: false,
        detail: `member ${m} threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (id !== undefined && (typeof id !== 'string' || id.length === 0)) {
      return {
        check: 'model-resolution',
        ok: false,
        detail: `member ${m} resolved to ${JSON.stringify(id)}, expected a model id or undefined`,
      };
    }
  }
  return { check: 'model-resolution', ok: true };
}

/**
 * Validate plan before release. Return one finding per check; release refuse
 * when any finding not ok.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @returns {DoctorFinding[]} Findings, in check order.
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
    checkModelResolution(plan, members),
  ];
}
