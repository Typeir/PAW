/**
 * PAW Brief Composition Use-Case
 *
 * @fileoverview The one place a member's final prompt is assembled: its rendered
 * brief, plus the contents of every file the plan attached to it, each fenced
 * under its own path. It lives in the application layer because reading a file
 * is a side effect and the swarm domain has none — the plan declares paths, this
 * resolves them through a {@link FileReaderPort}. Both the dispatcher and the
 * CLI's dry-run call it, which is what makes `paw swarm show` an honest preview:
 * what an author reads there is exactly what the model is sent. A member that
 * attaches nothing is sent its brief unchanged, byte for byte.
 *
 * @module @paw/core/application/composeBrief
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { contextOf, renderBrief, type SwarmPlan } from '../domain/swarm.js';
import type { FileReaderPort } from '../ports/index.js';

/**
 * The heading the attached files are gathered under.
 */
export const CONTEXT_HEADING = '## Attached context';

/**
 * Compose the prompt one member is actually sent.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number} member - Zero-based member index.
 * @param {FileReaderPort} files - The reader for attached context.
 * @returns {Promise<string>} The final prompt.
 */
export async function composeBrief<A>(
  plan: SwarmPlan<A>,
  member: number,
  files: FileReaderPort,
): Promise<string> {
  const brief = renderBrief(plan, member);
  const paths = contextOf(plan, member);
  if (paths.length === 0) {
    return brief;
  }
  const attached = await Promise.all(
    paths.map(async (path) => `### ${path}\n\`\`\`\n${await files.read(path)}\n\`\`\``),
  );
  return `${brief}\n\n${CONTEXT_HEADING}\n${attached.join('\n\n')}`;
}
