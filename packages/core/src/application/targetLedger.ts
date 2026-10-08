/**
 * PAW Target Ledger
 *
 * @fileoverview Hold a swarm plan's declared files across a run: record their
 * content before dispatch, create the ones a member cannot create for itself,
 * and judge each member against what it declared once the run settles. The
 * SDK `edit` tool modifies existing files only — a member granted `read` and
 * `edit` writes nothing unless its target already exists, so
 * {@link TargetLedger.createPlaceholders} makes them first.
 *
 * @module @paw/core/application/targetLedger
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  parentDir,
  proveMember,
  proveTarget,
  type MemberProof,
  type TargetProof,
} from '../domain/targetProof.js';
import { memberCount, targetsOf, type SwarmPlan } from '../domain/swarm.js';
import type { FileSystemPort } from '../ports/index.js';
import type { MemberOutcome } from './dispatchSwarm.js';

/**
 * Declared-file bookkeeping for one run.
 *
 * @interface TargetLedger
 * @property {() => Promise<void>} snapshot - Record current content of every declared file. Call before dispatch.
 * @property {() => Promise<readonly string[]>} createPlaceholders - Create an empty file at every declared path the snapshot found absent or empty, parents included. Returns those paths.
 * @property {(outcomes: readonly MemberOutcome[], wroteByPaw: readonly string[]) => Promise<MemberProof[]>} prove - Re-read every declared file and judge each member against its snapshot.
 */
export interface TargetLedger {
  snapshot(): Promise<void>;
  createPlaceholders(): Promise<readonly string[]>;
  prove(
    outcomes: readonly MemberOutcome[],
    wroteByPaw: readonly string[],
  ): Promise<MemberProof[]>;
}

/**
 * Open a ledger over a plan's declared files.
 *
 * A plan declaring no `expectFiles` yields an empty ledger: nothing to create,
 * every member `undeclared`.
 *
 * @param {SwarmPlan<A>} plan - The plan being dispatched.
 * @param {FileSystemPort} fs - Where declared files live.
 * @returns {TargetLedger} The ledger.
 */
export function openTargetLedger<A>(
  plan: SwarmPlan<A>,
  fs: FileSystemPort,
): TargetLedger {
  const before = new Map<string, string>();
  const members = Array.from({ length: memberCount(plan) }, (_v, m) => m);

  return {
    async snapshot(): Promise<void> {
      for (const member of members) {
        for (const path of targetsOf(plan, member)) {
          before.set(path, await fs.readText(path));
        }
      }
    },

    async createPlaceholders(): Promise<readonly string[]> {
      const made: string[] = [];
      for (const [path, content] of before) {
        if (content !== '') {
          continue;
        }
        const dir = parentDir(path);
        if (dir !== '') {
          await fs.ensureDir(dir);
        }
        await fs.writeText(path, '');
        made.push(path);
      }
      return made;
    },

    async prove(
      outcomes: readonly MemberOutcome[],
      wroteByPaw: readonly string[],
    ): Promise<MemberProof[]> {
      const wrote = new Set(wroteByPaw);
      const proofs: MemberProof[] = [];
      for (const outcome of outcomes) {
        const ran = outcome.state === 'done';
        const targets: TargetProof[] = [];
        if (ran) {
          for (const path of targetsOf(plan, outcome.member)) {
            targets.push(
              proveTarget(
                path,
                before.get(path) ?? '',
                await fs.readText(path),
                wrote.has(path),
              ),
            );
          }
        }
        proofs.push(proveMember(outcome.member, outcome.key, ran, targets));
      }
      return proofs;
    },
  };
}
