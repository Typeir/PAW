/**
 * @fileoverview Unit tests for the non-destructive hook-command merge. Puts PAW
 * in host's hook, no clobber user's command. Define surface of
 * `mergeHookCommand` and `chainCommand`, exercise every branch
 * (created / noop / corrected / appended) for 100% coverage.
 *
 * Merge host-agnostic: hardcode no invocation or chain operator. Domain
 * (a connector — Copilot's `hooks.json`, Claude's `settings.json`, …)
 * supply spec: canonical invocation, extra forms that also count as
 * PAW, and how PAW chains on. `chainCommand` be shell helper a connector
 * composes into that append strategy.
 *
 * Contract: find PAW in existing command (fuzzily, tolerate typos and
 * host-specific legacy forms); present → normalise PAW's run; absent → defer to
 * domain's `append`, leave user's command untouched.
 *
 * @module @paw/core/test/domain/hookMerge
 */

import { describe, expect, it } from 'vitest';
import {
  chainCommand,
  mergeHookCommand,
  type HookMergeSpec,
} from '../../src/index.js';

/**
 * Copilot-flavoured spec: `paw check`, legacy `.mjs` form as alias, and
 * a posix `&&` append. Override axis under test.
 *
 * @param over - Fields to override on default spec.
 */
const spec = (over: Partial<HookMergeSpec> = {}): HookMergeSpec => ({
  invocation: 'paw check',
  aliases: [/\.paw\/hooks\/\w+\.mjs/],
  append: (existing) => `${existing} && paw check`,
  ...over,
});

/**
 * Merge `existing` against default spec, optionally overridden.
 *
 * @param existing - Command already configured for hook event.
 * @param over - Spec overrides for this case.
 */
const m = (existing: string, over: Partial<HookMergeSpec> = {}) =>
  mergeHookCommand(existing, spec(over));

describe('mergeHookCommand — nothing there yet', () => {
  it('writes the bare invocation when there is no existing command', () => {
    expect(m('')).toEqual({ command: 'paw check', action: 'created' });
  });

  it('treats a whitespace-only command as empty', () => {
    expect(m('   \t ')).toEqual({ command: 'paw check', action: 'created' });
  });
});

describe('mergeHookCommand — PAW already present and correct', () => {
  it('is a no-op when the command is exactly the invocation', () => {
    expect(m('paw check')).toEqual({ command: 'paw check', action: 'noop' });
  });

  it('preserves surrounding whitespace on a no-op', () => {
    expect(m('  paw check  ')).toEqual({
      command: '  paw check  ',
      action: 'noop',
    });
  });

  it('is a no-op when PAW already sits correctly after a user command', () => {
    expect(m('eslint --fix && paw check')).toEqual({
      command: 'eslint --fix && paw check',
      action: 'noop',
    });
  });
});

describe('mergeHookCommand — PAW present but broken (correct in place)', () => {
  it('fixes a transposed binary (pwa → paw)', () => {
    expect(m('pwa check')).toEqual({ command: 'paw check', action: 'corrected' });
  });

  it('fixes a transposed subcommand (chekc → check)', () => {
    expect(m('paw chekc')).toEqual({ command: 'paw check', action: 'corrected' });
  });

  it('collapses accidental extra spacing', () => {
    expect(m('paw    check')).toEqual({ command: 'paw check', action: 'corrected' });
  });

  it('recognises a host alias (legacy .mjs) and normalises it', () => {
    expect(m('node --import tsx/esm .paw/hooks/preToolUse.mjs')).toEqual({
      command: 'paw check',
      action: 'corrected',
    });
  });

  it('corrects PAW in place without disturbing the user segment or order', () => {
    expect(m('paw chekc && eslint --fix')).toEqual({
      command: 'paw check && eslint --fix',
      action: 'corrected',
    });
  });

  it('corrects only PAW’s run, leaving a wrapping segment intact', () => {
    expect(m('if ($?) { paw chekc }')).toEqual({
      command: 'if ($?) { paw check }',
      action: 'corrected',
    });
  });
});

describe('mergeHookCommand — PAW absent (defer to domain append)', () => {
  it('chains PAW onto a single user command via the spec strategy', () => {
    expect(m('eslint --fix')).toEqual({
      command: 'eslint --fix && paw check',
      action: 'appended',
    });
  });

  it('appends after a multi-segment user command', () => {
    expect(m('tsc --noEmit && eslint')).toEqual({
      command: 'tsc --noEmit && eslint && paw check',
      action: 'appended',
    });
  });

  it('honours a domain-specific append strategy verbatim', () => {
    const r = m('lint', { append: (e) => `${e}; if ($?) { paw check }` });
    expect(r).toEqual({
      command: 'lint; if ($?) { paw check }',
      action: 'appended',
    });
  });

  it('leaves a different paw subcommand intact and appends alongside', () => {
    expect(m('paw doctor')).toEqual({
      command: 'paw doctor && paw check',
      action: 'appended',
    });
  });

  it('does not mistake a paw-prefixed tool for PAW', () => {
    expect(m('pawsome-lint run')).toEqual({
      command: 'pawsome-lint run && paw check',
      action: 'appended',
    });
  });

  it('does not treat a bare paw (no subcommand) as its own invocation', () => {
    expect(m('paw').action).toBe('appended');
  });

  it('works with no aliases configured', () => {
    expect(m('lint', { aliases: undefined }).action).toBe('appended');
  });
});

describe('chainCommand — shell-dependent joining a connector composes', () => {
  it('uses && on posix', () => {
    expect(chainCommand('lint', 'paw check', 'posix')).toBe('lint && paw check');
  });

  it('uses && on cmd', () => {
    expect(chainCommand('lint', 'paw check', 'cmd')).toBe('lint && paw check');
  });

  it('uses && on modern PowerShell', () => {
    expect(chainCommand('lint', 'paw check', 'pwsh')).toBe('lint && paw check');
  });

  it('guards with if ($?) on Windows PowerShell 5.1, which lacks &&', () => {
    expect(chainCommand('lint', 'paw check', 'pwsh5')).toBe(
      'lint; if ($?) { paw check }',
    );
  });
});
