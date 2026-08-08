/**
 * Context Argument Tests
 *
 * @fileoverview The pure half of `--context`: argv splitting in both flag
 * spellings, pattern splitting, glob compilation, expansion against a
 * repository listing, and attaching the result to a plan without trampling the
 * context a plan computes for itself.
 *
 * @module @paw/cli/test/unit/context
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { SwarmPlan } from '@paw/core';
import { describe, expect, it } from 'vitest';
import {
  concurrencyFrom,
  maxTokensFrom,
  globToRegExp,
  isGlob,
  parseArgs,
  resolveContext,
  splitPatterns,
  withContext,
} from '../../src/context.js';

const LISTING = [
  'src/main.ts',
  'src/context.ts',
  'src/domain/plan.ts',
  'docs/one.md',
  'README.md',
];

describe('parseArgs', () => {
  it('splits positionals, switches, and both spellings of a value flag', () => {
    const args = parseArgs(
      ['run', 'plan.mjs', '--live', '--context', 'a.ts,b.ts', '--port=8971'],
      ['context', 'port'],
    );
    expect(args.positional).toEqual(['run', 'plan.mjs']);
    expect([...args.flags]).toEqual(['live']);
    expect(args.values.get('context')).toBe('a.ts,b.ts');
    expect(args.values.get('port')).toBe('8971');
  });

  it('treats an unknown flag as a switch, and a valueless value-flag as one too', () => {
    const args = parseArgs(['--verbose', '--context'], ['context']);
    expect(args.flags.has('verbose')).toBe(true);
    expect(args.flags.has('context')).toBe(true);
    expect(args.values.has('context')).toBe(false);
  });

  it('parses an argv with no flags declared at all', () => {
    expect(parseArgs(['doctor', 'config.json']).positional).toEqual(['doctor', 'config.json']);
  });
});

describe('splitPatterns', () => {
  it('splits a comma list and trims it', () => {
    expect(splitPatterns(' a.ts , src/** ,')).toEqual(['a.ts', 'src/**']);
  });

  it('is empty when the flag was not given', () => {
    expect(splitPatterns(undefined)).toEqual([]);
    expect(splitPatterns('')).toEqual([]);
  });
});

describe('isGlob / globToRegExp', () => {
  it('tells a pattern from a plain path', () => {
    expect(isGlob('src/**')).toBe(true);
    expect(isGlob('a?.ts')).toBe(true);
    expect(isGlob('src/main.ts')).toBe(false);
  });

  it('keeps * inside one path segment and lets ** cross them', () => {
    expect(globToRegExp('src/*.ts').test('src/main.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/domain/plan.ts')).toBe(false);
    expect(globToRegExp('src/**/*.ts').test('src/domain/plan.ts')).toBe(true);
    expect(globToRegExp('src/**/*.ts').test('src/main.ts')).toBe(true);
    expect(globToRegExp('**').test('anything/at/all.md')).toBe(true);
  });

  it('matches a single character with ? and escapes the rest', () => {
    expect(globToRegExp('a?.ts').test('ab.ts')).toBe(true);
    expect(globToRegExp('a.ts').test('axts')).toBe(false);
  });
});

describe('resolveContext', () => {
  it('takes a literal path as written', () => {
    expect(resolveContext(['docs/one.md'], LISTING)).toEqual(['docs/one.md']);
    expect(resolveContext(['not/here.md'], LISTING)).toEqual(['not/here.md']);
  });

  it('expands a glob against the repository, sorted and deduplicated', () => {
    expect(resolveContext(['src/**/*.ts', 'src/main.ts'], LISTING)).toEqual([
      'src/context.ts',
      'src/domain/plan.ts',
      'src/main.ts',
    ]);
  });

  it('stops on a pattern that matched nothing rather than attaching nothing', () => {
    expect(() => resolveContext(['src/**/*.zzz'], LISTING)).toThrow(
      '--context pattern matched no files: src/**/*.zzz',
    );
  });

  it('resolves nothing when nothing was asked for', () => {
    expect(resolveContext([], LISTING)).toEqual([]);
  });
});

describe('withContext', () => {
  const plan: SwarmPlan<{ n: number }> = {
    name: 'demo',
    role: 'edit.apply',
    args: { n: 2 },
    members: 2,
    brief: (_a, m) => `brief ${m}`,
  };

  it('attaches the files to every member', () => {
    const attached = withContext(plan, ['a.md', 'b.md']);
    expect(attached.contextFiles?.(plan.args, 0)).toEqual(['a.md', 'b.md']);
    expect(attached.contextFiles?.(plan.args, 1)).toEqual(['a.md', 'b.md']);
  });

  it('adds to what the plan already computes for itself', () => {
    const own: SwarmPlan<{ n: number }> = {
      ...plan,
      contextFiles: (_a, m) => [`member-${m}.md`],
    };
    expect(withContext(own, ['shared.md']).contextFiles?.(own.args, 1)).toEqual([
      'member-1.md',
      'shared.md',
    ]);
  });

  it('leaves the plan alone when no files were named', () => {
    expect(withContext(plan, [])).toBe(plan);
  });
});

describe('concurrencyFrom', () => {
  it('takes the dispatcher default when nothing is asked for', () => {
    expect(concurrencyFrom(parseArgs([], ['concurrency']))).toBeUndefined();
  });

  it('forces one at a time on --sequential', () => {
    expect(concurrencyFrom(parseArgs(['--sequential'], ['concurrency']))).toBe(1);
  });

  it('takes an explicit bound, in either spelling', () => {
    expect(concurrencyFrom(parseArgs(['--concurrency=4'], ['concurrency']))).toBe(4);
    expect(concurrencyFrom(parseArgs(['--concurrency', '12'], ['concurrency']))).toBe(12);
  });

  it('lets an explicit bound win over the habit flag', () => {
    expect(
      concurrencyFrom(parseArgs(['--sequential', '--concurrency=6'], ['concurrency'])),
    ).toBe(6);
  });

  it('refuses a bound that is not a positive whole number', () => {
    for (const bad of ['0', '-2', '2.5', 'lots']) {
      expect(() =>
        concurrencyFrom(parseArgs([`--concurrency=${bad}`], ['concurrency'])),
      ).toThrow(/whole number/);
    }
  });
});

describe('maxTokensFrom', () => {
  it('takes the model default when nothing is asked for', () => {
    expect(maxTokensFrom(parseArgs([], ['max-tokens']))).toBeUndefined();
  });

  it('takes an explicit ceiling, in either spelling', () => {
    expect(maxTokensFrom(parseArgs(['--max-tokens=512'], ['max-tokens']))).toBe(512);
    expect(maxTokensFrom(parseArgs(['--max-tokens', '2000'], ['max-tokens']))).toBe(2000);
  });

  it('refuses a ceiling that is not a positive whole number', () => {
    for (const bad of ['0', '-2', '2.5', 'lots']) {
      expect(() =>
        maxTokensFrom(parseArgs([`--max-tokens=${bad}`], ['max-tokens'])),
      ).toThrow(/whole number/);
    }
  });
});
