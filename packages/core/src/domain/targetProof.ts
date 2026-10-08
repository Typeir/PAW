/**
 * PAW Target Proof Domain
 *
 * @fileoverview Turn a plan's `expectFiles` declaration into a verdict. A
 * member that ran is proved only when every file it declared carries content
 * it did not carry before. Pure: the caller supplies before/after content and
 * the paths PAW wrote itself. States are reported, never thrown; a swarm that
 * produced nothing must say so rather than exit clean.
 *
 * @module @paw/core/domain/targetProof
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

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
 * for it, so nothing can be enforced; `skipped` mean it never ran.
 */
export type MemberProofState = 'proved' | 'unproved' | 'undeclared' | 'skipped';

/**
 * One member and what it produced.
 *
 * @interface MemberProof
 * @property {number} member - Zero-based member index.
 * @property {string} key - Member resume key.
 * @property {MemberProofState} state - Whether it produced what it declared.
 * @property {readonly TargetProof[]} targets - One entry per declared file; empty when skipped or undeclared.
 */
export interface MemberProof {
  readonly member: number;
  readonly key: string;
  readonly state: MemberProofState;
  readonly targets: readonly TargetProof[];
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
    return { member, key, state: 'skipped', targets: [] };
  }
  if (targets.length === 0) {
    return { member, key, state: 'undeclared', targets };
  }
  const proved = targets.every((t) => t.state === 'written');
  return { member, key, state: proved ? 'proved' : 'unproved', targets };
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
