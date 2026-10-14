/**
 * PAW CLI — modules command
 *
 * @fileoverview `paw modules [enable|disable|install|uninstall <id>]`: list the
 * module catalogue with each entry's enabled state and whether it is
 * installed, edit that state in `.paw/config.json`, clone a module into
 * `.paw/modules/<id>` at the ref the catalogue pins, or remove one already
 * there. `--from` overrides the clone source with a path or URL. A failed
 * install removes the directory it just made, so the next attempt is not
 * refused as already installed. A module an enabled connector requires is
 * refused; an enabled module refuses to uninstall until it is disabled.
 * Install copies the module's `skills/<name>/` folders into `.claude/skills`
 * and lists them in `.git/info/exclude`; uninstall removes what it placed.
 *
 * @module @paw/cli/infrastructure/commands/modules
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  createNodeConfigDocument,
  createNodeModuleResolver,
  createNodeProcess,
} from '@paw/adapters';
import {
  MODULES_DIR,
  SKILLS_DIR,
  SKILL_MARKER,
  disableModule,
  enableModule,
  enabledModuleIds,
  excludeWith,
  excludeWithout,
  planInstall,
  planSkillPlacement,
  planUninstall,
  resolveModules,
  runInstall,
  skillsOwnedBy,
} from '@paw/core';
import { parseArgs } from '../../domain/context.js';
import { formatModules } from '../../domain/format.js';

/**
 * Skill folders an installed module ships: `skills/<name>/` holding a `SKILL.md`.
 *
 * @param {string} moduleDir - Absolute path of the installed module.
 * @returns {string[]} Skill folder names; empty when the module ships none.
 */
function moduleSkills(moduleDir: string): string[] {
  const dir = join(moduleDir, 'skills');
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name);
}

/**
 * Existing `.claude/skills` folders by name, with the module whose marker each holds.
 *
 * @param {string} root - Repository root.
 * @returns {Map<string, string | null>} Folder name → owning module id, or null when PAW did not place it.
 */
function skillOwners(root: string): Map<string, string | null> {
  const dir = join(root, SKILLS_DIR);
  if (!existsSync(dir)) {
    return new Map();
  }
  return new Map(
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const marker = join(dir, entry.name, SKILL_MARKER);
        return [entry.name, existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null];
      }),
  );
}

/**
 * Rewrite the repository's local git exclude file. Outside a git repository
 * there is nothing to exclude from, and nothing is written.
 *
 * @param {string} root - Repository root.
 * @param {(text: string) => string} transform - New text from the current text; current is empty when the file is absent.
 * @returns {Promise<void>} Resolve once written.
 */
async function rewriteExclude(root: string, transform: (text: string) => string): Promise<void> {
  const found = await createNodeProcess().run('git', ['rev-parse', '--git-path', 'info/exclude'], {
    cwd: root,
  });
  if (found.code !== 0) {
    return;
  }
  const path = resolve(root, found.stdout.trim());
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, transform(existsSync(path) ? readFileSync(path, 'utf8') : ''), 'utf8');
}

/**
 * Copy an installed module's skills into `.claude/skills`, mark them as the
 * module's, and keep them out of git.
 *
 * @param {string} root - Repository root.
 * @param {string} id - Module id.
 * @returns {Promise<string[]>} One line per placed or skipped skill.
 */
async function placeSkills(root: string, id: string): Promise<string[]> {
  const plan = planSkillPlacement(id, moduleSkills(join(root, MODULES_DIR, id)), skillOwners(root));
  for (const skill of plan.place) {
    rmSync(join(root, skill.to), { recursive: true, force: true });
    cpSync(join(root, skill.from), join(root, skill.to), { recursive: true });
    writeFileSync(join(root, skill.to, SKILL_MARKER), `${id}\n`, 'utf8');
  }
  if (plan.place.length > 0) {
    await rewriteExclude(root, (text) => excludeWith(text, plan.place.map((skill) => skill.to)));
  }
  return [
    ...plan.place.map((skill) => `modules: skill ${skill.name} → ${skill.to}`),
    ...plan.skipped.map((skill) => `modules: skill ${skill.name} not placed — ${skill.reason}`),
  ];
}

/**
 * Remove the skills a module placed, and their exclude lines.
 *
 * @param {string} root - Repository root.
 * @param {string} id - Module id.
 * @returns {Promise<string[]>} Removed folders, relative to the repository.
 */
async function removeSkills(root: string, id: string): Promise<string[]> {
  const owned = skillsOwnedBy(id, skillOwners(root));
  for (const path of owned) {
    rmSync(join(root, path), { recursive: true, force: true });
  }
  if (owned.length > 0) {
    await rewriteExclude(root, (text) => excludeWithout(text, owned));
  }
  return owned;
}

/**
 * Run `modules` subcommand.
 *
 * @param {string[]} rest - Words after `modules`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} Exit code: 0 when listed or edited, 1 when refused.
 */
export async function runModules(
  rest: string[],
  print: (lines: string[]) => void,
): Promise<number> {
  const args = parseArgs(rest, ['root', 'from']);
  const [sub, id] = args.positional;
  const root = resolve(args.values.get('root') ?? '.');
  const document = createNodeConfigDocument(root);
  const resolver = createNodeModuleResolver(root);
  const config = await document.read();

  if (sub === undefined) {
    print(formatModules(await resolveModules(config, resolver)));
    return 0;
  }
  if (sub !== 'enable' && sub !== 'disable' && sub !== 'install' && sub !== 'uninstall') {
    throw new Error(
      `unknown modules subcommand "${sub}": paw modules [enable|disable|install|uninstall <id>]`,
    );
  }
  if (id === undefined) {
    throw new Error(`paw modules ${sub} needs a module id`);
  }

  if (sub === 'install') {
    const plan = planInstall(id, args.values.get('from'), existsSync(join(root, MODULES_DIR, id)));
    if (!plan.ok) {
      print([`modules: ${plan.reason}`]);
      return 1;
    }
    print([`modules: cloning ${plan.source} into ${plan.target} at ${plan.ref}`]);
    const outcome = await runInstall(createNodeProcess(), root, plan);
    if (!outcome.ok) {
      rmSync(join(root, plan.target), { recursive: true, force: true });
      print([`modules: ${outcome.reason}`]);
      return 1;
    }
    print([
      `modules: ${id} installed — ${outcome.detail}`,
      ...(await placeSkills(root, id)),
      ...formatModules(await resolveModules(config, resolver)),
    ]);
    return 0;
  }

  if (sub === 'uninstall') {
    const plan = planUninstall(
      id,
      enabledModuleIds(config).includes(id),
      existsSync(join(root, MODULES_DIR, id)),
    );
    if (!plan.ok) {
      print([`modules: ${plan.reason}`]);
      return 1;
    }
    const skills = await removeSkills(root, id);
    rmSync(join(root, plan.target), { recursive: true, force: true });
    print([
      `modules: ${id} uninstalled — removed ${plan.target}`,
      ...skills.map((path) => `modules: removed skill ${path}`),
      ...formatModules(await resolveModules(config, resolver)),
    ]);
    return 0;
  }

  const edit = sub === 'enable' ? enableModule(config, id) : disableModule(config, id);
  if (!edit.ok) {
    print([`modules: ${edit.reason}`]);
    return 1;
  }
  await document.write(edit.config);
  print([
    `modules: ${id} ${sub}d`,
    ...formatModules(await resolveModules(edit.config, resolver)),
  ]);
  return 0;
}
