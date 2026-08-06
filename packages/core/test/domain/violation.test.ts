/**
 * PAW Violation Domain Tests
 *
 * @fileoverview Exercises every pure operation over a violation set so
 * `violation.ts` reaches 100% on its own, independent of the enforcement
 * decision that consumes it.
 *
 * @module @paw/core/test/domain/violation
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import {
  allIndirect,
  directlyViolatedFiles,
  formatIndirectNudge,
  formatOutstanding,
  type Violation,
} from '../../src/domain/violation.js';

/**
 * Build a violation with defaults, overriding only what a case needs.
 *
 * @param {Partial<Violation>} over - Fields to override.
 * @returns {Violation} A violation.
 */
const V = (over: Partial<Violation> = {}): Violation => ({
  id: 1,
  filePath: 'src/a.ts',
  rule: 'jsdoc',
  message: 'missing jsdoc',
  indirectFix: false,
  ...over,
});

describe('directlyViolatedFiles', () => {
  it('keeps only files with a direct violation and dedupes them', () => {
    const set = directlyViolatedFiles([
      V({ filePath: 'src/a.ts' }),
      V({ id: 2, filePath: 'src/a.ts' }),
      V({ id: 3, filePath: 'src/b.ts', indirectFix: true }),
    ]);
    expect([...set]).toEqual(['src/a.ts']);
  });

  it('returns an empty set when all violations are indirect', () => {
    expect(directlyViolatedFiles([V({ indirectFix: true })]).size).toBe(0);
  });
});

describe('allIndirect', () => {
  it('is true only when every violation is indirect-fix', () => {
    expect(allIndirect([V({ indirectFix: true })])).toBe(true);
    expect(allIndirect([V({ indirectFix: true }), V({ id: 2 })])).toBe(false);
  });

  it('is vacuously true for an empty set', () => {
    expect(allIndirect([])).toBe(true);
  });
});

describe('formatIndirectNudge', () => {
  it('lists each file and message under a nudge header', () => {
    const out = formatIndirectNudge([
      V({ filePath: 'src/a.ts', message: 'missing test' }),
    ]);
    expect(out).toBe(
      'Indirect fix required before continuing:\n- src/a.ts: missing test',
    );
  });
});

describe('formatOutstanding', () => {
  it('lists each outstanding file under a deny header', () => {
    expect(formatOutstanding(['src/a.ts', 'src/c.ts'])).toBe(
      'Fix outstanding violations before using other tools:\n- src/a.ts\n- src/c.ts',
    );
  });
});
