/**
 * PAW Herd Writer
 *
 * @fileoverview Persists what a herd produces, to the paths its plan declared.
 *
 * A plan says where its members write through `expectFiles` and writes nothing
 * itself — a plan that touched the disk could not be dry-run, doctored, or
 * previewed. So the declaration is the plan's and the writing is a consumer's,
 * and this is that consumer for the CLI.
 *
 * Written from each `settled` event rather than from the final result, because a
 * herd of four hundred against a live provider is minutes of paid work and a
 * failure at member sixty would otherwise throw away the fifty-nine already
 * bought. For the same reason a member whose file already exists can be skipped,
 * so a re-run resumes instead of paying twice.
 *
 * @module @paw/cli/application/herdWriter
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { targetsOf, type DispatchEvent, type FileSystemPort, type SwarmPlan } from '@paw/core';

/**
 * Persists a herd's output and reports what it wrote.
 *
 * @interface HerdWriter
 * @property {(event: DispatchEvent) => Promise<void>} onProgress - Hand to `dispatchSwarm`; writes each member as it settles.
 * @property {() => string[]} written - Every path written, in the order they landed.
 * @property {(key: string) => boolean} alreadyDone - Resume predicate: true once a member's declared output exists.
 */
export interface HerdWriter {
  onProgress(event: DispatchEvent): Promise<void>;
  written(): string[];
  alreadyDone(key: string): boolean;
}

/**
 * Build a writer for a plan.
 *
 * A member that declares no output file is a member with nothing to persist —
 * the run still happened and the console still showed it, so this is silence
 * rather than a failure. A member that declares one and produced no content is
 * the same: skipped and resumed members have no text to write.
 *
 * A failing write is not swallowed. It propagates through `onProgress` into the
 * dispatcher, which stops taking new members — losing the run is the correct
 * response to a disk that cannot keep it.
 *
 * @param {SwarmPlan<A>} plan - The plan being dispatched.
 * @param {FileSystemPort} fs - Where output goes.
 * @param {(path: string) => boolean} exists - Whether a path is already on disk, for resume.
 * @returns {HerdWriter} The writer.
 */
export function createHerdWriter<A>(
  plan: SwarmPlan<A>,
  fs: FileSystemPort,
  exists: (path: string) => boolean = () => false,
): HerdWriter {
  const paths: string[] = [];
  const keyTargets = new Map<string, string[]>();

  return {
    async onProgress(event: DispatchEvent): Promise<void> {
      if (event.phase !== 'settled' || event.outcome === undefined) {
        return;
      }
      const { outcome } = event;
      const targets = targetsOf(plan, outcome.member);
      keyTargets.set(outcome.key, targets);
      if (outcome.content === undefined) {
        return;
      }
      for (const target of targets) {
        await fs.ensureDir(target.slice(0, Math.max(0, target.lastIndexOf('/'))));
        await fs.writeText(target, outcome.content);
        paths.push(target);
      }
    },

    written(): string[] {
      return [...paths];
    },

    alreadyDone(key: string): boolean {
      const targets = keyTargets.get(key);
      return targets !== undefined && targets.length > 0 && targets.every(exists);
    },
  };
}

/**
 * The output paths a plan declares for every member, for a resume check made
 * before the run rather than during it.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number} total - How many members it has.
 * @returns {Map<string, string[]>} Resume key to declared outputs.
 */
export function declaredOutputs<A>(
  plan: SwarmPlan<A>,
  total: number,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (let member = 0; member < total; member += 1) {
    const key = plan.key ? plan.key(plan.args, member) : String(member);
    out.set(key, targetsOf(plan, member));
  }
  return out;
}
