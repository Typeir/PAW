/**
 * PAW Herd Writer
 *
 * @fileoverview Save what herd produce, to path plan declare. Plan declare where
 * member write through `expectFiles`, plan write nothing itself. This CLI
 * consumer do writing. Write from each `settled` event; mid-herd failure keep
 * member already produced. Skip member whose file already exist; re-run resume.
 *
 * @module @paw/cli/application/herdWriter
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { targetsOf, type DispatchEvent, type FileSystemPort, type SwarmPlan } from '@paw/core';

/**
 * Save herd output, report what write.
 *
 * @interface HerdWriter
 * @property {(event: DispatchEvent) => Promise<void>} onProgress - Hand to `dispatchSwarm`; write each member as it settle.
 * @property {() => string[]} written - Every path written, in order they land.
 * @property {(key: string) => boolean} alreadyDone - Resume check: true once member declared output exist.
 */
export interface HerdWriter {
  onProgress(event: DispatchEvent): Promise<void>;
  written(): string[];
  alreadyDone(key: string): boolean;
}

/**
 * Build writer for plan.
 *
 * Member declare no output file, or declare one and produce no content (skipped
 * and resumed member), write nothing.
 *
 * Failing write not swallow. It propagate through `onProgress` into dispatcher,
 * which stop take new member.
 *
 * @param {SwarmPlan<A>} plan - The plan being dispatch.
 * @param {FileSystemPort} fs - Where output go.
 * @param {(path: string) => boolean} exists - Whether path already on disk, for resume.
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
 * Output path plan declare for every member, for resume check made before run.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number} total - How many member it have.
 * @returns {Map<string, string[]>} Resume key to declared output.
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
