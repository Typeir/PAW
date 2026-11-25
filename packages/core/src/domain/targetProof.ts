/**
 * PAW Target Proof Domain
 *
 * @fileoverview Turn a plan's `expectFiles` declaration into a verdict. A
 * member that ran is proved only when every file it declared carries content
 * it did not carry before. Pure: the caller supplies before/after content and
 * the paths PAW wrote itself. States are reported, never thrown; a swarm that
 * produced nothing must say so rather than exit clean. A proved member whose
 * declared files hold open violations is `violating`.
 *
 * @module @paw/core/domain/targetProof
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { Violation } from './violation.js';

/**
 * Verdict for one declared file. `written` is the only pass.
 */
export type TargetState = 'written' | 'unchanged' | 'empty';

/**
 * One declared file and what became of it.
 *
 * @interface TargetProof
 * @property {string} path - Declared path, as the plan spells it.
 * @property {TargetState} state - What became of it.
 */
export interface TargetProof {
  readonly path: string;
  readonly state: TargetState;
}

/**
 * Verdict for one member. `undeclared` mean the plan declare no `expectFiles`
 * for it, so nothing can be enforced; `skipped` mean it never ran; `violating`
 * mean it produced its files and they hold open violations.
 */
export type MemberProofState = 'proved' | 'unproved' | 'violating' | 'undeclared' | 'skipped';

/**
 * One member and what it produced.
 *
 * @interface MemberProof
 * @property {number} member - Zero-based member index.
 * @property {string} key - Member resume key.
 * @property {MemberProofState} state - Whether it produced what it declared.
 * @property {readonly TargetProof[]} targets - One entry per declared file; empty when skipped or undeclared.
 * @property {readonly Violation[]} violations - Open violations in its declared files; non-empty only when `violating`.
 */
export interface MemberProof {
  readonly member: number;
  readonly key: string;
  readonly state: MemberProofState;
  readonly targets: readonly TargetProof[];
  readonly violations: readonly Violation[];
}

/**
 * Directory segment of a `/`-separated path, or `''` when it has none.
 *
 * @param {string} path - The path.
 * @returns {string} Parent directory, or `''` for a bare filename.
 */
export function parentDir(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/**
 * Judge one declared file. A path PAW wrote itself is proved by that write;
 * otherwise content must be non-empty and different from before.
 *
 * @param {string} path - Declared path.
 * @param {string} before - Content before the run; `''` when absent or empty.
 * @param {string} after - Content after the run; `''` when absent or empty.
 * @param {boolean} wroteByPaw - Whether PAW itself wrote this path during the run.
 * @returns {TargetProof} The verdict.
 */
export function proveTarget(
  path: string,
  before: string,
  after: string,
  wroteByPaw: boolean,
): TargetProof {
  if (wroteByPaw) {
    return { path, state: 'written' };
  }
  if (after === '') {
    return { path, state: 'empty' };
  }
  return { path, state: after === before ? 'unchanged' : 'written' };
}

/**
 * Judge one member from its target verdicts.
 *
 * @param {number} member - Zero-based member index.
 * @param {string} key - Member resume key.
 * @param {boolean} ran - False when the member was skipped or resumed.
 * @param {readonly TargetProof[]} targets - Verdicts for its declared files.
 * @returns {MemberProof} The verdict.
 */
export function proveMember(
  member: number,
  key: string,
  ran: boolean,
  targets: readonly TargetProof[],
): MemberProof {
  if (!ran) {
    return { member, key, state: 'skipped', targets: [], violations: [] };
  }
  if (targets.length === 0) {
    return { member, key, state: 'undeclared', targets, violations: [] };
  }
  const proved = targets.every((t) => t.state === 'written');
  return { member, key, state: proved ? 'proved' : 'unproved', targets, violations: [] };
}

/**
 * Members that ran and did not produce what they declared.
 *
 * @param {readonly MemberProof[]} proofs - Every member verdict.
 * @returns {MemberProof[]} The unproved ones, in order.
 */
export function unprovedMembers(proofs: readonly MemberProof[]): MemberProof[] {
  return proofs.filter((p) => p.state === 'unproved');
}

/**
 * Repo-relative path in one spelling: `/`-separated, no leading `./`.
 *
 * @param {string} path - Path as a plan or the store spells it.
 * @returns {string} Normalized path.
 */
function samePath(path: string): string {
  return path.split(String.fromCharCode(92)).join('/').replace(/^\.\//, '');
}

/**
 * Mark proved members whose declared files hold open violations as `violating`.
 *
 * @param {readonly MemberProof[]} proofs - Verdicts from the ledger.
 * @param {readonly Violation[]} violations - Open violations from the enforcement store.
 * @returns {MemberProof[]} Same verdicts; a proved member with a violation in a declared file becomes `violating` and carries them.
 */
export function judgeViolations(
  proofs: readonly MemberProof[],
  violations: readonly Violation[],
): MemberProof[] {
  return proofs.map((proof) => {
    if (proof.state !== 'proved') {
      return proof;
    }
    const declared = new Set(proof.targets.map((t) => samePath(t.path)));
    const held = violations.filter((v) => declared.has(samePath(v.filePath)));
    return held.length === 0 ? proof : { ...proof, state: 'violating', violations: held };
  });
}

/**
 * Why an unproved declared file did not count as produced.
 */
const UNPROVED_REASON: Readonly<Record<'empty' | 'unchanged', string>> = {
  empty: 'declared file is empty',
  unchanged: 'declared file is unchanged',
};

/**
 * Why a member failed, one line per failing file.
 *
 * @param {MemberProof} proof - One verdict.
 * @returns {string[]} `<reason>: <path>` per unproduced file, `<path> holds N open violation(s): <rules>` per violating file; empty for any other state.
 */
export function proofFailures(proof: MemberProof): string[] {
  if (proof.state === 'unproved') {
    return proof.targets.flatMap((t) =>
      t.state === 'written' ? [] : [`${UNPROVED_REASON[t.state]}: ${t.path}`],
    );
  }
  if (proof.state !== 'violating') {
    return [];
  }
  const byFile = new Map<string, string[]>();
  for (const v of proof.violations) {
    byFile.set(v.filePath, [...(byFile.get(v.filePath) ?? []), v.rule]);
  }
  return [...byFile].map(
    ([file, rules]) =>
      `${file} holds ${rules.length} open violation(s): ${[...new Set(rules)].join(', ')}`,
  );
}
