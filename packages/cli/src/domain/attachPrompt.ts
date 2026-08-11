/**
 * PAW Attach Prompt
 *
 * @fileoverview Render what terminal running `paw ui` show when console ask
 * attach repository, and read operator answer. Approval happens at this
 * terminal, typed by whoever starts daemon. Does no I/O; `main.ts` owns stdin
 * and writes. This decides what to show and what a keystroke means.
 *
 * @module @paw/cli/domain/attachPrompt
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { InitMode } from '@paw/core';

/**
 * What answer at prompt resolve to.
 */
export type AttachAnswer = 'approve' | 'refuse';

/**
 * Lines show when console ask attach repository. State path and consequence of
 * mode.
 *
 * @param {string} path - Repository the console named.
 * @param {InitMode} mode - How it ask existing config get resolved.
 * @returns {string[]} Lines to print.
 */
export function attachPromptLines(path: string, mode: InitMode): string[] {
  const consequence =
    mode === 'override'
      ? 'REPLACING .paw/config.json — anything already in it is lost'
      : mode === 'merge'
        ? 'keeping every existing key and adding what is missing'
        : 'writing .paw/config.json only if the repository has none';
  return [
    '',
    'the console is asking to attach PAW to a repository',
    `  path: ${path}`,
    `  mode: ${mode} — ${consequence}`,
    '  approve? [y/N] ',
  ];
}

/**
 * Read operator's answer. Anything other than clear yes refuse; stray keystroke,
 * empty line, or closed stdin leave repository untouched.
 *
 * @param {string} input - What was typed.
 * @returns {AttachAnswer} The answer.
 */
export function readAttachAnswer(input: string): AttachAnswer {
  const answer = input.trim().toLowerCase();
  return answer === 'y' || answer === 'yes' ? 'approve' : 'refuse';
}

/**
 * Line printed once attach get resolved.
 *
 * @param {string} path - The repository.
 * @param {string[]} written - Paths written; empty when nothing was.
 * @param {string} [refusal] - Why plan refuse to write config, if it did.
 * @returns {string} Line to print.
 */
export function attachOutcomeLine(
  path: string,
  written: readonly string[],
  refusal?: string,
): string {
  if (refusal !== undefined) {
    return `attach ${path}: ${refusal}`;
  }
  return written.length === 0
    ? `attach ${path}: nothing written`
    : `attach ${path}: wrote ${written.join(', ')}`;
}
