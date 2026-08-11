/**
 * PAW CLI context arguments.
 *
 * @fileoverview Pure half of `--context`. Read flags off argv, expand pattern
 * against repo listing, attach result to plan. Console file selector and this
 * flag both end at `SwarmPlan.contextFiles`. `dispatchSwarm` read through a
 * port. Fail loud per CONSTRAINTS.md Constraint 3. Pattern match nothing throw.
 *
 * @module @paw/cli/domain/context
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { SwarmPlan } from '@paw/core';

/**
 * Split argv into positional words, flags, and values.
 *
 * @interface ParsedArgs
 * @property {string[]} positional - Words not flags nor flag values.
 * @property {ReadonlySet<string>} flags - Bare `--flag` switch, no dashes.
 * @property {ReadonlyMap<string, string>} values - `--flag=value` and `--flag value` pair.
 */
export interface ParsedArgs {
  readonly positional: string[];
  readonly flags: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, string>;
}

/**
 * Number of concurrent swarm members to run, from operator flags.
 * Dispatch batch by default. `--sequential` forces one at a time.
 * `--concurrency=N` sets the bound directly, overriding `--sequential`.
 *
 * @param {ParsedArgs} args - Parsed subcommand arguments.
 * @returns {number | undefined} Bound, or undefined take dispatcher default.
 * @throws {Error} When `--concurrency` not positive whole number.
 */
export function concurrencyFrom(args: ParsedArgs): number | undefined {
  const raw = args.values.get('concurrency');
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(
        `--concurrency must be a whole number of one or more, got "${raw}"`,
      );
    }
    return parsed;
  }
  return args.flags.has('sequential') ? 1 : undefined;
}

/**
 * Per-run output ceiling, from operator flags. `--max-tokens=N` cap every
 * member token for this run. Override bound model default. Absent, member
 * take model default. Collect here. `dispatchSwarm` apply it.
 *
 * @param {ParsedArgs} args - Parsed subcommand arguments.
 * @returns {number | undefined} Ceiling, or undefined take model default.
 * @throws {Error} When `--max-tokens` not positive whole number.
 */
export function maxTokensFrom(args: ParsedArgs): number | undefined {
  const raw = args.values.get('max-tokens');
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--max-tokens must be a whole number of one or more, got "${raw}"`);
  }
  return parsed;
}

/**
 * Split argv, given flags that take value. Accept both `--flag value` and
 * `--flag=value`.
 *
 * @param {readonly string[]} argv - Words to parse.
 * @param {readonly string[]} valueFlags - Flag name (no dashes) that take value.
 * @returns {ParsedArgs} Split argv.
 */
export function parseArgs(
  argv: readonly string[],
  valueFlags: readonly string[] = [],
): ParsedArgs {
  const positional: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const word = argv[i];
    if (!word.startsWith('--')) {
      positional.push(word);
      continue;
    }
    const body = word.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      values.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    if (valueFlags.includes(body) && i + 1 < argv.length) {
      values.set(body, argv[i + 1]);
      i += 1;
      continue;
    }
    flags.add(body);
  }

  return { positional, flags, values };
}

/**
 * Split `--context` value into patterns. Drop empties trailing comma left.
 *
 * @param {string | undefined} value - Raw flag value.
 * @returns {string[]} Patterns.
 */
export function splitPatterns(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Whether pattern hold glob syntax.
 *
 * @param {string} pattern - The pattern.
 * @returns {boolean} True when pattern must match as glob.
 */
export function isGlob(pattern: string): boolean {
  return /[*?[\]]/.test(pattern);
}

/**
 * Compile glob to regex over `/`-separated paths. `**` cross directory
 * boundary. `*` and `?` not.
 *
 * @param {string} pattern - The glob.
 * @returns {RegExp} Anchored matcher.
 */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        const slash = pattern[i + 2] === '/';
        out += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
        continue;
      }
      out += '[^/]*';
      continue;
    }
    if (char === '?') {
      out += '[^/]';
      continue;
    }
    out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/**
 * Expand pattern operator give against repo files. Literal path take as
 * written. Glob match nothing throw here.
 *
 * @param {readonly string[]} patterns - Patterns from `--context`.
 * @param {readonly string[]} candidates - Every file path in repo.
 * @returns {string[]} Resolved paths, sorted and deduped.
 */
export function resolveContext(
  patterns: readonly string[],
  candidates: readonly string[],
): string[] {
  const out = new Set<string>();
  for (const pattern of patterns) {
    if (!isGlob(pattern)) {
      out.add(pattern);
      continue;
    }
    const matcher = globToRegExp(pattern);
    const hits = candidates.filter((path) => matcher.test(path));
    if (hits.length === 0) {
      throw new Error(`--context pattern matched no files: ${pattern}`);
    }
    for (const hit of hits) {
      out.add(hit);
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/**
 * Attach fixed set of files to every member of plan. Empty `paths` leave
 * plan own `contextFiles` untouched.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {readonly string[]} paths - Files to attach to every member.
 * @returns {SwarmPlan<A>} Plan, with attachment applied.
 */
export function withContext<A>(plan: SwarmPlan<A>, paths: readonly string[]): SwarmPlan<A> {
  if (paths.length === 0) {
    return plan;
  }
  const declared = plan.contextFiles;
  return {
    ...plan,
    contextFiles: (args: A, member: number) => [
      ...(declared ? declared(args, member) : []),
      ...paths,
    ],
  };
}
