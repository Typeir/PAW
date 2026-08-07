/**
 * PAW Attach Prompt
 *
 * @fileoverview What the terminal running `paw ui` shows when a console asks to
 * attach a repository, and what an operator's answer means.
 *
 * The approval is deliberately here and not on the socket that made the request.
 * A console able to approve its own request is a console that can write to the
 * filesystem, which is the property the request pattern exists to avoid — so the
 * request arrives over the wire and the answer arrives from the keyboard of
 * whoever started the daemon.
 *
 * Pure: `main.ts` owns stdin and the write, this decides what is shown and what
 * a keystroke means.
 *
 * @module @paw/cli/attachPrompt
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { InitMode } from '@paw/core';

/**
 * What an answer at the prompt resolves to.
 */
export type AttachAnswer = 'approve' | 'refuse';

/**
 * The lines shown when a console asks to attach a repository.
 *
 * States the path and the consequence rather than only the mode, because the
 * difference between merging and overwriting a config is the whole reason an
 * operator is being asked, and `override` is the one that destroys work.
 *
 * @param {string} path - The repository the console named.
 * @param {InitMode} mode - How it asked for an existing config to be resolved.
 * @returns {string[]} The lines to print.
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
 * Read an operator's answer.
 *
 * Anything that is not an explicit yes refuses, so a stray keystroke, an empty
 * line, or a closed stdin all leave the repository untouched.
 *
 * @param {string} input - What was typed.
 * @returns {AttachAnswer} The answer.
 */
export function readAttachAnswer(input: string): AttachAnswer {
  const answer = input.trim().toLowerCase();
  return answer === 'y' || answer === 'yes' ? 'approve' : 'refuse';
}

/**
 * The line printed once an attach has been resolved.
 *
 * @param {string} path - The repository.
 * @param {string[]} written - Paths that were written; empty when nothing was.
 * @param {string} [refusal] - Why the plan refused to write the config, if it did.
 * @returns {string} The line to print.
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
