/**
 * PAW Brief Composition Use-Case
 *
 * @fileoverview Put together member final prompt. Render brief plus read every
 * file plan attach, fence each under own path. Plan declare path; this resolve
 * through {@link FileReaderPort}. Dispatcher and CLI dry-run both call it;
 * `paw swarm show` preview exact prompt sent. Member attach nothing get brief
 * unchanged.
 *
 * @module @paw/core/application/composeBrief
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { contextOf, renderBrief, type SwarmPlan } from '../domain/swarm.js';
import type { FileReaderPort } from '../ports/index.js';

/**
 * Heading attached files sit under.
 */
export const CONTEXT_HEADING = '## Attached context';

/**
 * Compose prompt sent to one member.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number} member - Member index, start at zero.
 * @param {FileReaderPort} files - Read attached context.
 * @returns {Promise<string>} Final prompt.
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
