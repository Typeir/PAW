/**
 * PAW TUI Init Prompt
 *
 * @fileoverview Renders a conflict from existing `.paw/config.json`. Conflict kind (config present, PAW wrote it, edited since) comes from `@paw/core`; this module maps which choice the operator picks and which key triggers it.
 *
 * Resolution is not expressible by CLI flag alone: `paw init
 * --merge` requires knowing the conflict exists before choosing. Every surface presents the same {@link InitConflict}; this module renders it for the terminal.
 *
 * I/O belongs to the shell: it reads the file and writes the result. This module only maps keypresses to choices.
 *
 * @module @paw/tui/domain/initPrompt
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { InitConflict, InitMode } from '@paw/core';

/**
 * Choices an operator can make. `cancel` means no write at
 * all; no `InitMode` expresses that.
 */
export type InitChoice = InitMode | 'cancel';

/**
 * One offered resolution.
 *
 * @interface InitOption
 * @property {InitChoice} choice - Choice this row selects when committed.
 * @property {string} label - Row's name.
 * @property {string} detail - What it do to file on disk.
 */
export interface InitOption {
  readonly choice: InitChoice;
  readonly label: string;
  readonly detail: string;
}

/**
 * Resolutions for the conflict, ordered so the first row is `Cancel`,
 * where the cursor starts and where a stray Enter leaves config untouched.
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
 * Prompt's state.
 *
 * @interface InitPromptState
 * @property {InitConflict} conflict - What found at config path.
 * @property {number} cursor - Index into {@link INIT_OPTIONS}.
 * @property {InitChoice | null} decision - Committed choice, or null while still open.
 */
export interface InitPromptState {
  readonly conflict: InitConflict;
  readonly cursor: number;
  readonly decision: InitChoice | null;
}

/**
 * Open prompt for conflict.
 *
 * @param {InitConflict} conflict - What found at config path.
 * @returns {InitPromptState} Initial state, cursor on `Cancel` (index 0).
 */
export function initPromptState(conflict: InitConflict): InitPromptState {
  return { conflict, cursor: 0, decision: null };
}

/**
 * Map keypress to next prompt state.
 *
 * Once `decision` is set, the state is closed: a keypress after
 * the operator answered must not change the answer the shell
 * has acted on.
 *
 * @param {InitPromptState} state - Current state.
 * @param {string} key - Key name.
 * @returns {InitPromptState} Next state.
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
