/**
 * Linter Connector Tests
 *
 * @fileoverview Cover the pure linter half: commands per connector (tsc whole
 * project, eslint scoped to files, null for non-linters), the tsc diagnostic
 * parser (paths normalised, non-diagnostic lines skipped), and the eslint JSON
 * parser (findings per message, garbage output reads as no findings).
 *
 * @module @paw/core/test/domain/linters
 */

import { describe, expect, it } from 'vitest';
import {
  linterCommandFor,
  parseEslintJson,
  parseTscOutput,
} from '../../src/domain/linters.js';

describe('linterCommandFor', () => {
  it('scopes eslint to the touched files and tsc to the project', () => {
    expect(linterCommandFor('eslint', ['a.ts', 'b.tsx'])).toEqual({
      bin: 'eslint',
      args: ['--format', 'json', 'a.ts', 'b.tsx'],
    });
    expect(linterCommandFor('tsc', ['a.ts'])).toEqual({
      bin: 'tsc',
      args: ['--noEmit', '--pretty', 'false'],
    });
    expect(linterCommandFor('copilot-hooks', [])).toBeNull();
  });
});

describe('parseTscOutput', () => {
  it('reads diagnostics with normalised paths and skips everything else', () => {
    const out = [
      'src\\lib\\a.ts(42,7): error TS1005: \':\' expected.',
      'npm notice noise',
      'src/lib/b.tsx(7,1): error TS2304: Cannot find name \'x\'.',
      '',
    ].join('\n');
    expect(parseTscOutput(out)).toEqual([
      { filePath: 'src/lib/a.ts', line: 42, rule: 'tsc/TS1005', message: "':' expected." },
      { filePath: 'src/lib/b.tsx', line: 7, rule: 'tsc/TS2304', message: "Cannot find name 'x'." },
    ]);
    expect(parseTscOutput('')).toEqual([]);
  });
});

describe('parseEslintJson', () => {
  it('reads one finding per message, defaulting absent fields', () => {
    const out = JSON.stringify([
      {
        filePath: 'C:\\repo\\src\\a.ts',
        messages: [
          { ruleId: 'no-unused-vars', line: 3, message: 'x is unused' },
          { ruleId: null, message: 'Parsing error' },
        ],
      },
      { filePath: 42, messages: [] },
      { messages: 'nope' },
    ]);
    expect(parseEslintJson(out)).toEqual([
      { filePath: 'C:/repo/src/a.ts', line: 3, rule: 'eslint/no-unused-vars', message: 'x is unused' },
      { filePath: 'C:/repo/src/a.ts', line: 0, rule: 'eslint/parse', message: 'Parsing error' },
    ]);
  });

  it('reads garbage and non-array output as no findings', () => {
    expect(parseEslintJson('eslint exploded')).toEqual([]);
    expect(parseEslintJson('{"not":"an array"}')).toEqual([]);
    expect(parseEslintJson(JSON.stringify([{ filePath: 'a.ts', messages: [{}] }]))).toEqual([
      { filePath: 'a.ts', line: 0, rule: 'eslint/parse', message: '' },
    ]);
  });
});
