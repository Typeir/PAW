/**
 * @fileoverview Technician pass over the caveman JSDoc: one member per source
 * file, each strips metaphor, self-justification, and conceptual framing from
 * comments, leaving terse technical fact. Same scope controls as the caveman
 * plan: PAW_SWEEP_FILES names a target list file; else PAW_SWEEP_PKG picks a
 * package or 'all'. Resume keys are the file paths.
 *
 *   PAW_SWEEP_PKG=all paw swarm run plans/technician-jsdoc.swarm.mjs --live
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
  name: `technician-jsdoc-${PKG}`,
  role: 'edit.apply',
  args: { files },
  members: (a) => a.files.length,
  availableTools: ['read', 'edit'],
  brief: (a, m) =>
    [
      'You are editing a TypeScript file in place with your tools.',
      `Open ${a.files[m]} and read it fully.`,
      '',
      "The file's comments were compressed into a terse voice, but metaphor and",
      'rhetoric survived. A JSDoc comment is a technical specification. Rewrite',
      'every comment sentence that is not a plain technical fact.',
      '',
      '# Delete or replace',
      '* Metaphor and personification: "painted traffic light on web page costume",',
      '  "twin that own second brain", "herd bolt", "costume", "smeared across".',
      '  Replace with the literal mechanism: what it is, what it does, what it',
      '  reads or writes, when it runs.',
      '* Self-justifying sentences: "What both shells share be real each way",',
      '  "honest seam", "the whole point", "never lie", "be convenience for".',
      '  If a sentence defends the design instead of describing behavior, delete',
      '  it, or state the underlying constraint as a plain fact.',
      '* Contrast rhetoric: "X, not Y", "no X, only Y", "X rather than Y". State',
      '  what IS. Keep a negative only when it is a real limit a caller must know',
      '  ("a sandboxed preload cannot be an ES module" stays).',
      '* Value words with no measurement: real, honest, clean, proper, deliberate.',
      '',
      '# Keep',
      '* The terse grammar. Dropped articles are fine.',
      '* Every JSDoc tag in its position; rewrite only the prose after the tag.',
      '* Factual rationale: failure modes, limits, sizes, versions. "setx',
      '  truncates PATH at 1024 characters" is a fact and stays.',
      '* All code byte-identical: imports, types, exports, identifiers, string',
      '  literals, and code inside @example blocks.',
      '',
      '# Example',
      '* Before: "What both shells share be real each way: wordmark, daemon pill',
      '  read from snapshot, theme toggle."',
      '* After: "Both shells render wordmark, daemon pill from snapshot, theme',
      '  toggle."',
      '',
      'Edit the file in place with str_replace edits. Do not print the file back.',
      'If every comment already reads as plain fact, change nothing.',
      'When done, reply with one short line naming what you changed.',
    ].join('\n'),
  expectFiles: (a, m) => a.files[m],
  key: (a, m) => a.files[m],
};
