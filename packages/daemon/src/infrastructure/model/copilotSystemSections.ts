/**
 * PAW Copilot Slim System Sections
 *
 * @fileoverview Slim system-prompt baseline Copilot port inject. Compressed
 * copy runtime CLI persona in plain English with markdown headings, split
 * by SDK section id in sibling JSON, written to output. Lift each
 * non-empty `slim` to id→content map. dispatchSwarm compose with plan
 * `system`; port replace those section (`systemMessage.customize`). Every
 * section stay present so tool loop survive. Section not in file
 * (tool_instructions, environment_context, session/runtime) stay SDK own —
 * fixed SDK contract or runtime-derived.
 *
 * @module @paw/daemon/model/copilotSystemSections
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import sectionsFile from './copilotSystemSections.json';

/**
 * One section in JSON.
 *
 * @interface SystemSectionEntry
 * @property {string} id - SDK section id content replace.
 * @property {string} slim - Compressed content. Empty = not slimmed yet, skip.
 * @property {string} full - Verbatim captured content, keep for reference.
 */
export interface SystemSectionEntry {
  readonly id: string;
  readonly slim: string;
  readonly full: string;
}

/**
 * Lift non-empty slim to id→content baseline. Empty slim skip — that section
 * stay SDK default.
 *
 * @param {Readonly<Record<string, SystemSectionEntry>>} sections - File `sections` map.
 * @returns {Record<string, string>} Slim baseline, id to content.
 */
export function slimSectionsOf(
  sections: Readonly<Record<string, SystemSectionEntry>>,
): Record<string, string> {
  const baseline: Record<string, string> = {};
  for (const entry of Object.values(sections)) {
    if (entry.slim.length > 0) {
      baseline[entry.id] = entry.slim;
    }
  }
  return baseline;
}

/**
 * Slim baseline, resolve from JSON at load.
 */
export const COPILOT_SLIM_SECTIONS: Record<string, string> = slimSectionsOf(
  (sectionsFile as { sections: Record<string, SystemSectionEntry> }).sections,
);
