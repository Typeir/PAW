/**
 * @fileoverview Final caveman JSDoc herd: one member per source file. Each member
 * rewrites every JSDoc block and comment in its file to caveman voice, editing in
 * place through the agent tools. Scope comes from the environment at load:
 * PAW_SWEEP_FILES names a file holding one target path per line (re-herding
 * survivors); otherwise PAW_SWEEP_PKG — a package name ('core', 'daemon', ...)
 * sweeps that package's src and test trees, 'all' sweeps every package. Gate a
 * release with tsc + vitest. Resume keys are the file paths.
 *
 *   PAW_SWEEP_PKG=core paw swarm run plans/caveman-jsdoc.swarm.mjs --live
 *   PAW_SWEEP_FILES=survivors.txt paw swarm run plans/caveman-jsdoc.swarm.mjs --live
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PKG = process.env.PAW_SWEEP_PKG ?? 'core';
const LIST = process.env.PAW_SWEEP_FILES;

/**
 * Every .ts/.tsx file under a root, recursive; declaration files excluded.
 * A missing root yields nothing.
 *
 * @param {string} root - Directory to walk.
 * @returns {string[]} Forward-slash paths.
 */
function tsFilesUnder(root) {
  let entries;
  try {
    entries = readdirSync(root, { recursive: true });
  } catch {
    return [];
  }
  return entries
    .map(String)
    .filter((p) => /\.(ts|tsx)$/.test(p) && !p.endsWith('.d.ts'))
    .map((p) => join(root, p).replaceAll('\\', '/'));
}

const files = LIST
  ? readFileSync(LIST, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .sort()
  : (PKG === 'all' ? readdirSync('packages') : [PKG])
      .flatMap((pkg) => [`packages/${pkg}/src`, `packages/${pkg}/test`])
      .flatMap(tsFilesUnder)
      .sort();

/** @type {import('../packages/core/src/domain/swarm.js').SwarmPlan<{ files: string[] }>} */
export default {
  name: `caveman-jsdoc-${PKG}`,
  role: 'edit.apply',
  args: { files },
  members: (a) => a.files.length,
  availableTools: ['read', 'edit'],
  brief: (a, m) =>
    [
      'You are editing a TypeScript file in place with your tools.',
      `Open ${a.files[m]} with the editor tool and read it fully.`,
      '',
      'Rewrite EVERY JSDoc block and comment in the file into full caveman voice:',
      'blunt, terse, present-tense, dropped articles, no filler. Keep it technically',
      'accurate — a reader must still learn what the thing does. Example voice:',
      '"Canonical event. Host no talk own words to core. Connector translate at edge."',
      '',
      'HARD RULES:',
      '- Change ONLY comments and JSDoc text. Leave every line of code — imports,',
      '  types, exports, values, identifiers, string literals — byte-for-byte',
      '  identical.',
      '- Keep every JSDoc tag (@fileoverview, @module, @param, @property, @returns,',
      '  @throws, @interface, @callback, @version, @author, @since, @example, {@link})',
      '  exactly where it is; caveman the prose after each tag only. Never touch the',
      '  code inside @example blocks.',
      '- Edit the file in place with str_replace edits. Do NOT print the file back',
      '  to me.',
      '- If the file has no comments or JSDoc, change nothing.',
      '- When done, reply with one short line naming what you changed.',
    ].join('\n'),
  expectFiles: (a, m) => a.files[m],
  key: (a, m) => a.files[m],
};
