/**
 * PAW Module Skills
 *
 * @fileoverview Places the agent skills a module ships into a repository. A
 * module's skills are its `skills/<name>/` folders; each is copied to
 * `.claude/skills/<name>`, which VS Code agent mode and Claude Code both read.
 * Placement is pure: the caller reports which folders exist and who owns them
 * (the module id in each placed folder's marker, or null for one PAW did not
 * place), and copies. Placed paths go in `.git/info/exclude`, so git never
 * sees them.
 *
 * @module @paw/core/application/moduleSkills
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { MODULES_DIR } from './moduleInstall.js';

/**
 * Directory, relative to a repository, skills are placed in.
 */
export const SKILLS_DIR = '.claude/skills';

/**
 * Marker file in a placed skill folder; holds the owning module id.
 */
export const SKILL_MARKER = '.paw-module';

/**
 * One skill folder to copy.
 *
 * @interface SkillPlacement
 * @property {string} name - Skill folder name.
 * @property {string} from - Source, relative to the repository.
 * @property {string} to - Destination, relative to the repository.
 */
export interface SkillPlacement {
  readonly name: string;
  readonly from: string;
  readonly to: string;
}

/**
 * Skills to place, and skills left out with the reason.
 *
 * @interface SkillPlan
 * @property {readonly SkillPlacement[]} place - Folders to copy, replacing this module's own copy.
 * @property {readonly { name: string; reason: string }[]} skipped - Folders held by someone else.
 */
export interface SkillPlan {
  readonly place: readonly SkillPlacement[];
  readonly skipped: readonly { readonly name: string; readonly reason: string }[];
}

/**
 * Plan placing a module's skills. A free folder or this module's own is
 * placed; a folder another module owns, or one PAW did not place, is skipped.
 *
 * @param {string} id - Module id.
 * @param {readonly string[]} skills - Skill folder names the installed module ships.
 * @param {ReadonlyMap<string, string | null>} owners - Existing `.claude/skills` folders by name: owning module id, or null when PAW did not place it. Absent names are free.
 * @returns {SkillPlan} What to copy and what to leave.
 */
export function planSkillPlacement(
  id: string,
  skills: readonly string[],
  owners: ReadonlyMap<string, string | null>,
): SkillPlan {
  const place: SkillPlacement[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const name of skills) {
    const to = `${SKILLS_DIR}/${name}`;
    const owner = owners.get(name);
    if (owner === null) {
      skipped.push({
        name,
        reason: `${to} already exists and PAW did not place it; remove it to let ${id} place its skill`,
      });
    } else if (owner !== undefined && owner !== id) {
      skipped.push({ name, reason: `${to} belongs to module ${owner}` });
    } else {
      place.push({ name, from: `${MODULES_DIR}/${id}/skills/${name}`, to });
    }
  }
  return { place, skipped };
}

/**
 * Placed skill folders one module owns, for removal on uninstall.
 *
 * @param {string} id - Module id.
 * @param {ReadonlyMap<string, string | null>} owners - Existing `.claude/skills` folders by name and owner.
 * @returns {string[]} Folders to remove, relative to the repository.
 */
export function skillsOwnedBy(id: string, owners: ReadonlyMap<string, string | null>): string[] {
  return [...owners].filter(([, owner]) => owner === id).map(([name]) => `${SKILLS_DIR}/${name}`);
}

/**
 * Exclude-file line for a placed folder.
 *
 * @param {string} path - Folder, relative to the repository.
 * @returns {string} Anchored directory pattern.
 */
function excludeLine(path: string): string {
  return `/${path}/`;
}

/**
 * `.git/info/exclude` text with each path present once; existing lines kept.
 *
 * @param {string} text - Current file text; empty when the file does not exist.
 * @param {readonly string[]} paths - Placed folders, relative to the repository.
 * @returns {string} New file text.
 */
export function excludeWith(text: string, paths: readonly string[]): string {
  const lines = new Set(text.split('\n'));
  const missing = paths.map(excludeLine).filter((line) => !lines.has(line));
  if (missing.length === 0) {
    return text;
  }
  const base = text === '' || text.endsWith('\n') ? text : `${text}\n`;
  return `${base}${missing.join('\n')}\n`;
}

/**
 * `.git/info/exclude` text without the given paths.
 *
 * @param {string} text - Current file text.
 * @param {readonly string[]} paths - Removed folders, relative to the repository.
 * @returns {string} New file text.
 */
export function excludeWithout(text: string, paths: readonly string[]): string {
  const drop = new Set(paths.map(excludeLine));
  return text
    .split('\n')
    .filter((line) => !drop.has(line))
    .join('\n');
}
