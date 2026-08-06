/**
 * PAW CLI Context Arguments
 *
 * @fileoverview The pure half of `--context`: reading flags off an argv,
 * expanding the patterns an operator typed against a listing of the repository,
 * and attaching the result to a plan. The console's file selector and this flag
 * are two faces of the same seam — both end at `SwarmPlan.contextFiles`, which
 * `dispatchSwarm` reads through a port — so a run started from the terminal and
 * one started from a selection agree byte for byte. Fails loud per CONSTRAINTS.md
 * Constraint 3: a pattern that matches nothing is a mistake worth stopping for,
 * not a quietly empty attachment.
 *
 * @module @paw/cli/context
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { SwarmPlan } from '@paw/core';

/**
 * An argv split into what it means.
 *
 * @interface ParsedArgs
 * @property {string[]} positional - The words that are not flags or flag values.
 * @property {ReadonlySet<string>} flags - Bare `--flag` switches, without the dashes.
 * @property {ReadonlyMap<string, string>} values - `--flag=value` and `--flag value` pairs.
 */
export interface ParsedArgs {
  readonly positional: string[];
  readonly flags: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, string>;
}

/**
 * Split an argv, given the flags that take a value. Both `--flag value` and
 * `--flag=value` are accepted, because both are what people type.
 *
 * @param {readonly string[]} argv - The words to parse.
 * @param {readonly string[]} valueFlags - Flag names (without dashes) that take a value.
 * @returns {ParsedArgs} The split argv.
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
 * Split a `--context` value into patterns, dropping the empties a trailing
 * comma leaves behind.
 *
 * @param {string | undefined} value - The raw flag value.
 * @returns {string[]} The patterns.
 */
export function splitPatterns(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Whether a pattern contains glob syntax rather than naming one file.
 *
 * @param {string} pattern - The pattern.
 * @returns {boolean} True when it must be matched rather than taken literally.
 */
export function isGlob(pattern: string): boolean {
  return /[*?[\]]/.test(pattern);
}

/**
 * Compile a glob to a regular expression over `/`-separated paths. `**` crosses
 * directory boundaries, `*` and `?` do not.
 *
 * @param {string} pattern - The glob.
 * @returns {RegExp} An anchored matcher.
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
 * Expand the patterns an operator gave against the repository's files. A literal
 * path is taken as written — whether it exists is the file reader's business,
 * and it says so loudly at dispatch — while a glob that matches nothing throws
 * here, before a single member is briefed.
 *
 * @param {readonly string[]} patterns - The patterns from `--context`.
 * @param {readonly string[]} candidates - Every file path in the repository.
 * @returns {string[]} The resolved paths, sorted and deduplicated.
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
 * Attach a fixed set of files to every member of a plan. The plan keeps its own
 * `contextFiles` when the operator named none, so a plan that computes its own
 * per-member context is not overwritten by an empty flag.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {readonly string[]} paths - The files to attach to every member.
 * @returns {SwarmPlan<A>} The plan, with the attachment applied.
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
