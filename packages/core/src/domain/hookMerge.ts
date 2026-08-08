/**
 * PAW Hook-Command Merge
 *
 * @fileoverview The rule that installs PAW into a host's hook command without
 * ever clobbering the user's own. It is HOST-AGNOSTIC: the domain — a connector
 * for Copilot's `hooks.json`, Claude's `settings.json`, or any other surface —
 * supplies a {@link HookMergeSpec} carrying its canonical invocation, the extra
 * forms that also count as PAW, and how PAW chains on. This module only knows the
 * shape of the operation, never a particular host.
 *
 * Detection is fuzzy on purpose: a hand-edited hook accretes typos and stale
 * forms, and PAW must recognise itself through them rather than duplicate itself.
 * Distance is Optimal String Alignment (restricted Damerau–Levenshtein) so an
 * adjacent transposition — the commonest human slip — costs one, not two.
 *
 * @module @paw/core/domain/hookMerge
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * What the merge did to the command.
 */
export type MergeAction = 'created' | 'noop' | 'corrected' | 'appended';

/**
 * The merged command and the action taken to reach it.
 *
 * @interface HookMerge
 * @property {string} command - The command to write back for the hook event.
 * @property {MergeAction} action - Which branch produced it.
 */
export interface HookMerge {
  readonly command: string;
  readonly action: MergeAction;
}

/**
 * The host-specific inputs the merge is parameterised over.
 *
 * @interface HookMergeSpec
 * @property {string} invocation - This host's canonical PAW invocation (e.g. `paw check`); drives both detection and correction.
 * @property {readonly RegExp[]} [aliases] - Extra forms that count as PAW for this host (e.g. the legacy `.mjs` launcher); each must be non-global.
 * @property {(existing: string) => string} append - The domain's own strategy for chaining PAW onto a foreign command.
 */
export interface HookMergeSpec {
  readonly invocation: string;
  readonly aliases?: readonly RegExp[];
  readonly append: (existing: string) => string;
}

/**
 * The shells a connector may target when composing its {@link HookMergeSpec.append}.
 */
export type HookShell = 'posix' | 'cmd' | 'pwsh' | 'pwsh5';

const SEPARATOR = /(\s*(?:&&|\|\||;)\s*)/;

/**
 * Restricted Damerau–Levenshtein (Optimal String Alignment) distance.
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns The edit distance, counting an adjacent transposition as one.
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
 * The whitespace-delimited tokens of a segment, with their offsets.
 *
 * @param segment - One command segment (between chain operators).
 * @returns Each token's text and start index within the segment.
 */
function tokensOf(segment: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  for (const match of segment.matchAll(/\S+/g)) {
    out.push({ text: match[0], start: match.index });
  }
  return out;
}

/**
 * Rewrite a segment so any PAW run it holds becomes the canonical invocation,
 * reporting whether the segment was PAW at all. A fuzzy `binary + subcommand`
 * run is spliced in place; a host alias replaces the segment's trimmed content.
 *
 * @param segment - The segment to inspect.
 * @param spec - The host spec.
 * @param binary - The invocation's leading token.
 * @param sub - The invocation's subcommand token.
 * @returns The (possibly rewritten) segment and whether it was recognised as PAW.
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
 * Merge PAW into a host's existing hook command, non-destructively.
 *
 * @param existing - The command already configured for the hook event.
 * @param spec - The host-specific invocation, aliases, and append strategy.
 * @returns The merged command and the action taken.
 *
 * @description
 * Empty → write the bare invocation (`created`). Otherwise scan the operator-
 * delimited segments for PAW: the first recognised one is normalised in place
 * (`corrected`, or `noop` when it was already right). If none is PAW, the user's
 * command is left whole and the domain's `append` chains PAW on (`appended`).
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
 * Join PAW onto a foreign command with the operator the shell supports — the
 * building block a connector composes into its {@link HookMergeSpec.append}.
 *
 * @param existing - The user's command.
 * @param invocation - PAW's canonical invocation.
 * @param shell - The shell that will run the merged command.
 * @returns The chained command. Windows PowerShell 5.1 lacks `&&`, so it is
 * guarded with `; if ($?) { … }`; every other shell uses `&&`.
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
