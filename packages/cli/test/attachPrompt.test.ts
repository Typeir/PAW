/**
 * PAW Attach Prompt Tests
 *
 * @fileoverview Pins what an operator is told and what their keystroke means.
 * The bias is the point: only an explicit yes approves, so every other input —
 * a stray key, an empty line, a closed stdin — leaves the repository alone.
 *
 * @module @paw/cli/test/attachPrompt
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import {
  attachOutcomeLine,
  attachPromptLines,
  readAttachAnswer,
} from '../src/domain/attachPrompt.js';

describe('attachPromptLines', () => {
  it('names the repository and the mode', () => {
    const text = attachPromptLines('/home/x/thing', 'merge').join('\n');
    expect(text).toContain('/home/x/thing');
    expect(text).toContain('merge');
  });

  it('spells out that override destroys what is there', () => {
    const text = attachPromptLines('/home/x/thing', 'override').join('\n');
    expect(text).toContain('REPLACING');
    expect(text).toContain('lost');
  });

  it('says merge keeps existing keys', () => {
    expect(attachPromptLines('/r', 'merge').join('\n')).toContain('keeping every existing key');
  });

  it('says create only writes when there is no config', () => {
    expect(attachPromptLines('/r', 'create').join('\n')).toContain('only if the repository has none');
  });

  it('asks with the refusing default shown', () => {
    expect(attachPromptLines('/r', 'create').join('\n')).toContain('[y/N]');
  });
});

describe('readAttachAnswer', () => {
  it('approves on an explicit yes, in any case or spacing', () => {
    for (const input of ['y', 'Y', 'yes', 'YES', '  y  ', 'Yes\n']) {
      expect(readAttachAnswer(input)).toBe('approve');
    }
  });

  it('refuses on anything else', () => {
    for (const input of ['', '\n', 'n', 'no', 'yeah', 'yep', 'ok', 'q', '   ']) {
      expect(readAttachAnswer(input)).toBe('refuse');
    }
  });
});

describe('attachOutcomeLine', () => {
  it('lists what was written', () => {
    expect(attachOutcomeLine('/r', ['/r/.paw/config.json', '/r/.git/hooks/pre-commit'])).toBe(
      'attach /r: wrote /r/.paw/config.json, /r/.git/hooks/pre-commit',
    );
  });

  it('says so when nothing was written', () => {
    expect(attachOutcomeLine('/r', [])).toBe('attach /r: nothing written');
  });

  it('reports a refusal in the plan’s own words', () => {
    expect(attachOutcomeLine('/r', [], 'config already exists')).toBe(
      'attach /r: config already exists',
    );
  });
});
