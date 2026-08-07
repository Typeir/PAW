/**
 * PAW TUI Init Prompt
 *
 * @fileoverview The terminal's answer to an existing `.paw/config.json`. The
 * verdict — whether a config is there, whether PAW wrote it, whether it has been
 * edited since — comes from `@paw/core`; this decides only what a terminal
 * operator is offered and which key means what.
 *
 * It exists because the resolution cannot be a CLI flag alone. `paw init
 * --merge` is a fine answer for someone who already knows what they will find,
 * and no answer at all for someone who does not — so every surface presents the
 * same {@link InitConflict}, and this is the terminal's presentation of it.
 *
 * Pure, like the rest of the TUI's state: the shell reads the file and performs
 * the write, this maps a keypress to an intent.
 *
 * @module @paw/tui/initPrompt
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { InitConflict, InitMode } from '@paw/core';

/**
 * What an operator can choose. `cancel` is not an `InitMode` — it means no
 * write happens at all, which no mode expresses.
 */
export type InitChoice = InitMode | 'cancel';

/**
 * One offered resolution.
 *
 * @interface InitOption
 * @property {InitChoice} choice - The intent this row commits to.
 * @property {string} label - The row's name.
 * @property {string} detail - What it does to the file on disk.
 */
export interface InitOption {
  readonly choice: InitChoice;
  readonly label: string;
  readonly detail: string;
}

/**
 * The offered resolutions, safest first. `cancel` leads because the cursor
 * starts on the first row, and the first row is the one a mistaken Enter picks.
 */
export const INIT_OPTIONS: readonly InitOption[] = [
  { choice: 'cancel', label: 'Cancel', detail: 'leave the config untouched' },
  {
    choice: 'merge',
    label: 'Merge',
    detail: 'keep every existing key, add only what is missing',
  },
  {
    choice: 'override',
    label: 'Override',
    detail: 'replace the file; everything currently in it is lost',
  },
];

/**
 * The prompt's state.
 *
 * @interface InitPromptState
 * @property {InitConflict} conflict - What was found at the config path.
 * @property {number} cursor - Index into {@link INIT_OPTIONS}.
 * @property {InitChoice | null} decision - The committed choice, or null while still open.
 */
export interface InitPromptState {
  readonly conflict: InitConflict;
  readonly cursor: number;
  readonly decision: InitChoice | null;
}

/**
 * Open the prompt for a conflict.
 *
 * @param {InitConflict} conflict - What was found at the config path.
 * @returns {InitPromptState} The initial state, on the safe option.
 */
export function initPromptState(conflict: InitConflict): InitPromptState {
  return { conflict, cursor: 0, decision: null };
}

/**
 * Map a keypress to the next prompt state.
 *
 * Once a decision is committed the state is inert: a keypress arriving after
 * the operator has answered must not change the answer the shell is already
 * acting on.
 *
 * @param {InitPromptState} state - The current state.
 * @param {string} key - The key name.
 * @returns {InitPromptState} The next state.
 */
export function reduceInitPrompt(
  state: InitPromptState,
  key: string,
): InitPromptState {
  if (state.decision !== null) {
    return state;
  }
  if (key === 'j' || key === 'down') {
    return { ...state, cursor: Math.min(state.cursor + 1, INIT_OPTIONS.length - 1) };
  }
  if (key === 'k' || key === 'up') {
    return { ...state, cursor: Math.max(state.cursor - 1, 0) };
  }
  if (key === 'return') {
    return { ...state, decision: INIT_OPTIONS[state.cursor].choice };
  }
  if (key === 'escape') {
    return { ...state, decision: 'cancel' };
  }
  return state;
}
