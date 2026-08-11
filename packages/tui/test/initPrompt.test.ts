/**
 * PAW TUI Init Prompt Tests
 *
 * @fileoverview Cover choice terminal operator get when attach PAW to repo
 * that already have config, and rendered frame they see. Verdict come from
 * `@paw/core`; these pin TUI offer exactly resolutions CLI flags offer, default
 * to cancel, and always dismiss without writing.
 *
 * @module @paw/tui/test/initPrompt
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { stampConfig, type InitConflict } from '@paw/core';
import { describe, expect, it } from 'vitest';
import {
  INIT_OPTIONS,
  initPromptState,
  reduceInitPrompt,
} from '../src/domain/initPrompt.js';
import { renderInitPrompt } from '../src/domain/screen.js';

const UNSTAMPED: InitConflict = { kind: 'unstamped' };
const STAMPED: InitConflict = {
  kind: 'stamped',
  stamp: { version: '5.0.0', hash: 'abc123abc123' },
  edited: true,
};

describe('initPromptState', () => {
  it('starts on cancel, so a stray Enter writes nothing', () => {
    const state = initPromptState(UNSTAMPED);
    expect(INIT_OPTIONS[state.cursor].choice).toBe('cancel');
    expect(state.decision).toBeNull();
  });

  it('offers exactly the resolutions the CLI flags offer', () => {
    expect(INIT_OPTIONS.map((o) => o.choice)).toEqual(['cancel', 'merge', 'override']);
  });
});

describe('reduceInitPrompt', () => {
  it('moves down and up without leaving the list', () => {
    let state = initPromptState(UNSTAMPED);
    state = reduceInitPrompt(state, 'j');
    expect(INIT_OPTIONS[state.cursor].choice).toBe('merge');
    state = reduceInitPrompt(state, 'k');
    expect(INIT_OPTIONS[state.cursor].choice).toBe('cancel');
  });

  it('clamps at both ends', () => {
    let state = initPromptState(UNSTAMPED);
    state = reduceInitPrompt(state, 'k');
    expect(state.cursor).toBe(0);
    for (let i = 0; i < 10; i += 1) {
      state = reduceInitPrompt(state, 'j');
    }
    expect(state.cursor).toBe(INIT_OPTIONS.length - 1);
  });

  it('accepts arrow keys as well as vi keys', () => {
    const down = reduceInitPrompt(initPromptState(UNSTAMPED), 'down');
    expect(INIT_OPTIONS[down.cursor].choice).toBe('merge');
    expect(reduceInitPrompt(down, 'up').cursor).toBe(0);
  });

  it('commits the highlighted option on enter', () => {
    let state = reduceInitPrompt(initPromptState(UNSTAMPED), 'j');
    state = reduceInitPrompt(state, 'return');
    expect(state.decision).toBe('merge');
  });

  it('cancels on escape whatever is highlighted', () => {
    let state = reduceInitPrompt(initPromptState(UNSTAMPED), 'j');
    state = reduceInitPrompt(state, 'escape');
    expect(state.decision).toBe('cancel');
  });

  it('ignores keys that mean nothing here', () => {
    const state = initPromptState(UNSTAMPED);
    expect(reduceInitPrompt(state, 'x')).toEqual(state);
  });

  it('is inert once decided, so a late keypress cannot change the answer', () => {
    const decided = reduceInitPrompt(initPromptState(UNSTAMPED), 'return');
    expect(reduceInitPrompt(decided, 'j')).toEqual(decided);
  });
});

describe('renderInitPrompt', () => {
  it('says PAW did not write an unstamped config', () => {
    const text = renderInitPrompt(initPromptState(UNSTAMPED)).lines.join('\n');
    expect(text).toContain('not written by PAW');
  });

  it('names the version and the edit for a stamped config', () => {
    const text = renderInitPrompt(initPromptState(STAMPED)).lines.join('\n');
    expect(text).toContain('5.0.0');
    expect(text).toContain('edited');
  });

  it('reports a stamped config that was not edited', () => {
    const text = renderInitPrompt(
      initPromptState({ ...STAMPED, edited: false }),
    ).lines.join('\n');
    expect(text).not.toContain('edited since');
  });

  it('marks the highlighted option and only that one', () => {
    const lines = renderInitPrompt(initPromptState(UNSTAMPED)).lines;
    expect(lines.filter((l) => l.includes('›'))).toHaveLength(1);
  });

  it('renders every row at the same width', () => {
    const lines = renderInitPrompt(initPromptState(STAMPED)).lines;
    const widths = new Set(lines.map((l) => l.length));
    expect(widths.size).toBe(1);
  });

  it('never renders a prompt for a repo with no config', () => {
    const text = renderInitPrompt(initPromptState({ kind: 'absent' })).lines.join('\n');
    expect(text).toContain('nothing to resolve');
  });

  it('matches the committed frame', () => {
    expect(renderInitPrompt(initPromptState(STAMPED)).lines).toMatchSnapshot();
  });
});
