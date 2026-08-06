/**
 * PAW Config Validation Tests
 *
 * @fileoverview Covers `validateConfig` across a valid config, a non-object, all
 * missing required fields, and an unknown connector — so `config.ts` reaches 100%.
 *
 * @module @paw/core/test/domain/config
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../src/domain/config.js';

const KNOWN = ['copilot-hooks', 'copilot-sdk'];

describe('validateConfig', () => {
  it('accepts a well-formed config', () => {
    expect(
      validateConfig(
        { root: '.paw', gatesDir: '.paw/gates', connector: 'copilot-hooks' },
        KNOWN,
      ),
    ).toEqual([]);
  });

  it('rejects a non-object outright', () => {
    expect(validateConfig(null, KNOWN)).toEqual([
      { field: '(root)', message: 'config must be an object' },
    ]);
  });

  it('flags every missing required field', () => {
    const problems = validateConfig({}, KNOWN);
    expect(problems.map((p) => p.field)).toEqual(['root', 'gatesDir', 'connector']);
  });

  it('flags an unresolvable connector', () => {
    const problems = validateConfig(
      { root: 'a', gatesDir: 'b', connector: 'anthropic-mystery' },
      KNOWN,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].field).toBe('connector');
    expect(problems[0].message).toContain('unknown connector');
  });
});
