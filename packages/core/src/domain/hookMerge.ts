/**
 * PAW hook-command merge.
 *
 * @fileoverview Rule put PAW into host hook command, but no clobber user own. HOST-AGNOSTIC: domain — connector for Copilot `hooks.json`, Claude `settings.json`, any surface — give {@link HookMergeSpec} with canonical invocation, extra forms count as PAW, and how PAW chain on. Module know only shape of operation, never particular host.
 *
 * Hand-edited hooks accumulate typos and stale forms, so detection is fuzzy: a run within edit distance of the canonical form is recognised as PAW and rewritten to it. Distance is Optimal String Alignment (restricted Damerau–Levenshtein), so adjacent transposition — commonest human slip — cost one, not two.
 *
 * @module @paw/core/domain/hookMerge
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * What merge do to command.
 */
export type MergeAction = 'created' | 'noop' | 'corrected' | 'appended';

/**
 * Merged command and action reach it.
 *
 * @interface HookMerge
 * @property {string} command - Command write back for hook event.
 * @property {MergeAction} action - Which branch produce it.
 */
export interface HookMerge {
  readonly command: string;
  readonly action: MergeAction;
}

/**
 * Host-specific inputs merge parameterise over.
 *
 * @interface HookMergeSpec
 * @property {string} invocation - This host canonical PAW invocation (e.g. `paw check`); drive both detection and correction.
 * @property {readonly RegExp[]} [aliases] - Extra forms count as PAW for this host (e.g. legacy `.mjs` launcher); each must be non-global.
 * @property {(existing: string) => string} append - Domain own strategy for chaining PAW onto foreign command.
 */
export interface HookMergeSpec {
  readonly invocation: string;
  readonly aliases?: readonly RegExp[];
  readonly append: (existing: string) => string;
}

/**
 * Shells connector may target when compose its {@link HookMergeSpec.append}.
 */
export type HookShell = 'posix' | 'cmd' | 'pwsh' | 'pwsh5';

const SEPARATOR = /(\s*(?:&&|\|\||;)\s*)/;

/**
 * Restricted Damerau–Levenshtein (Optimal String Alignment) distance.
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns Edit distance, count adjacent transposition as one.
 */
function osa(a: string, b: string): number {
  const rows = a.length;
  const cols = b.length;
  const d: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  );
  for (let i = 0; i <= rows; i += 1) d[i][0] = i;
  for (let j = 0; j <= cols; j += 1) d[0][j] = j;
  for (let i = 1; i <= rows; i += 1) {
    for (let j = 1; j <= cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[rows][cols];
}

/**
 * Whitespace-delimited tokens of segment, with offsets.
 *
 * @param segment - One command segment (between chain operators).
 * @returns Each token text and start index within segment.
 */
function tokensOf(segment: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  for (const match of segment.matchAll(/\S+/g)) {
    out.push({ text: match[0], start: match.index });
  }
  return out;
}

/**
 * Rewrite segment. Any PAW run it hold become canonical invocation.
 * Report whether segment be PAW at all. Fuzzy `binary + subcommand`
 * run splice in place; host alias replace segment trimmed content.
 *
 * @param segment - Segment to inspect.
 * @param spec - Host spec.
 * @param binary - Invocation leading token.
 * @param sub - Invocation subcommand token.
 * @returns (Possibly rewritten) segment and whether recognised as PAW.
 */
function rewriteSegment(
  segment: string,
  spec: HookMergeSpec,
  binary: string,
  sub: string,
): { isPaw: boolean; fixed: string } {
  const tokens = tokensOf(segment);
  for (let k = 0; k < tokens.length - 1; k += 1) {
    const bare = tokens[k].text.replace(/^\.[\\/]/, '');
    if (osa(bare, binary) <= 1 && osa(tokens[k + 1].text, sub) <= 2) {
      const runEnd = tokens[k + 1].start + tokens[k + 1].text.length;
      const fixed =
        segment.slice(0, tokens[k].start) +
        spec.invocation +
        segment.slice(runEnd);
      return { isPaw: true, fixed };
    }
  }
  if (spec.aliases?.some((re) => re.test(segment))) {
    const lead = segment.length - segment.trimStart().length;
    const fixed =
      segment.slice(0, lead) + spec.invocation + segment.slice(segment.trimEnd().length);
    return { isPaw: true, fixed };
  }
  return { isPaw: false, fixed: segment };
}

/**
 * Merge PAW into host existing hook command, non-destructively.
 *
 * @param existing - Command already configured for hook event.
 * @param spec - Host invocation, aliases, append strategy.
 * @returns Merged command and action taken.
 *
 * @description
 * Empty → write bare invocation (`created`). Else scan operator-
 * delimited segments for PAW: first recognised normalise in place
 * (`corrected`, or `noop` when already right). If none be PAW, user
 * command stay whole and domain `append` chain PAW on (`appended`).
 */
export function mergeHookCommand(existing: string, spec: HookMergeSpec): HookMerge {
  if (existing.trim() === '') {
    return { command: spec.invocation, action: 'created' };
  }
  const [binary, sub = ''] = spec.invocation.trim().split(/\s+/);
  const parts = existing.split(SEPARATOR);
  for (let i = 0; i < parts.length; i += 2) {
    const { isPaw, fixed } = rewriteSegment(parts[i], spec, binary, sub);
    if (isPaw) {
      parts[i] = fixed;
      const command = parts.join('');
      return { command, action: command === existing ? 'noop' : 'corrected' };
    }
  }
  return { command: spec.append(existing), action: 'appended' };
}

/**
 * Join PAW onto foreign command with operator shell support — the
 * building block connector compose into its {@link HookMergeSpec.append}.
 *
 * @param existing - User command.
 * @param invocation - PAW canonical invocation.
 * @param shell - Shell run merged command.
 * @returns Chained command. Windows PowerShell 5.1 lack `&&`, so guard
 * with `; if ($?) { … }`; every other shell use `&&`.
 */
export function chainCommand(
  existing: string,
  invocation: string,
  shell: HookShell,
): string {
  if (shell === 'pwsh5') {
    return `${existing}; if ($?) { ${invocation} }`;
  }
  return `${existing} && ${invocation}`;
}
