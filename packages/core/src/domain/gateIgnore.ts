/**
 * PAW Gate-Ignore Directives
 *
 * @fileoverview Parses `paw:gate:` suppression directives from source text and
 * decides whether a finding is suppressed. Pure string work with no filesystem
 * access — the gate orchestrator hands it file contents. Ported from the legacy
 * `gateIgnore.ts` and given a testable seam: `parseIgnoreDirectives` builds the
 * directive index once per file, `isSuppressed` queries it per finding.
 *
 * The directive body is `paw:gate:{id}[:{rule}] (ignore|ignore-nextline)`,
 * wrapped in any comment style: a TypeScript block comment, an MDX JSX comment
 * (`{`-block-`}`), or an HTML comment (`<!-- -->`). `ignore` suppresses the
 * whole file; `ignore-nextline` suppresses only the following line. Both the
 * gate id and the optional rule id are case-insensitive, and `*` is the
 * wildcard for either.
 *
 * @module @paw/core/domain/gateIgnore
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Parsed suppression directives for one file.
 *
 * @interface IgnoreDirectives
 * @property {Map<string, Set<string>>} fileLevel - Gate id → suppressed rule ids ('*' suppresses all rules for that gate), applied to the whole file.
 * @property {Map<number, Map<string, Set<string>>>} nextLine - 1-based target line → gate id → suppressed rule ids, applied to that line only.
 */
export interface IgnoreDirectives {
  readonly fileLevel: Map<string, Set<string>>;
  readonly nextLine: Map<number, Map<string, Set<string>>>;
}

/**
 * Build a fresh directive regex. A new instance per parse avoids shared
 * `lastIndex` state between calls.
 *
 * @returns {RegExp} A global, case-insensitive directive matcher.
 */
function directivePattern(): RegExp {
  return /(?:\/\*|\{\/\*|<!--)\s*paw:gate:([\w*-]+)(?::([\w*-]+))?\s+(ignore(?:-nextline)?)\s*(?:\*\/\}|\*\/|-->)/gi;
}

/**
 * Record one parsed directive into the file-level or next-line index.
 *
 * @param {IgnoreDirectives} into - The index being built.
 * @param {number} lineIndex - Zero-based index of the line the directive is on.
 * @param {string} gateId - Lower-cased gate id (or '*').
 * @param {string} rule - Lower-cased rule id (or '*').
 * @param {string} mode - Either `ignore` or `ignore-nextline`.
 */
function record(
  into: IgnoreDirectives,
  lineIndex: number,
  gateId: string,
  rule: string,
  mode: string,
): void {
  if (mode === 'ignore') {
    const rules = into.fileLevel.get(gateId) ?? new Set<string>();
    rules.add(rule);
    into.fileLevel.set(gateId, rules);
    return;
  }
  const targetLine = lineIndex + 2;
  const byGate = into.nextLine.get(targetLine) ?? new Map<string, Set<string>>();
  const rules = byGate.get(gateId) ?? new Set<string>();
  rules.add(rule);
  byGate.set(gateId, rules);
  into.nextLine.set(targetLine, byGate);
}

/**
 * Parse all `paw:gate:` directives from a file's source text.
 *
 * @param {string} content - Full file source.
 * @returns {IgnoreDirectives} The parsed directive index.
 */
export function parseIgnoreDirectives(content: string): IgnoreDirectives {
  const result: IgnoreDirectives = {
    fileLevel: new Map(),
    nextLine: new Map(),
  };
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    for (const m of lines[i].matchAll(directivePattern())) {
      record(result, i, m[1].toLowerCase(), (m[2] ?? '*').toLowerCase(), m[3]);
    }
  }
  return result;
}

/**
 * Normalise an id for comparison: dashes stripped, lower-cased. Lets
 * `file-length` and `filelength` match.
 *
 * @param {string} id - A gate or rule id.
 * @returns {string} The normalised form.
 */
function normalizeId(id: string): string {
  return id.replace(/-/g, '').toLowerCase();
}

/**
 * Whether a suppression gate id matches the finding's gate.
 *
 * @param {string} id - A gate id from a directive.
 * @param {string} gateId - The finding's gate id.
 * @returns {boolean} True when they match (including `*`).
 */
function matchesGate(id: string, gateId: string): boolean {
  return id === '*' || id === gateId || normalizeId(id) === normalizeId(gateId);
}

/**
 * Whether a directive's rule set covers the finding's rule.
 *
 * @param {Set<string>} rules - Suppressed rule ids for a gate.
 * @param {string} rule - The finding's rule id.
 * @returns {boolean} True when covered (including `*`).
 */
function matchesRule(rules: Set<string>, rule: string): boolean {
  return rules.has('*') || rules.has(rule);
}

/**
 * Whether a finding is suppressed by the parsed directives.
 *
 * @param {IgnoreDirectives} directives - Parsed directives for the finding's file.
 * @param {string} gateId - Id of the gate producing the finding.
 * @param {string} rule - Rule identifier within that gate.
 * @param {number} [line] - 1-based line number of the finding, if known.
 * @returns {boolean} True when the finding should be removed.
 */
export function isSuppressed(
  directives: IgnoreDirectives,
  gateId: string,
  rule: string,
  line?: number,
): boolean {
  for (const [id, rules] of directives.fileLevel) {
    if (matchesGate(id, gateId) && matchesRule(rules, rule)) {
      return true;
    }
  }
  if (typeof line === 'number') {
    const byGate = directives.nextLine.get(line);
    if (byGate) {
      for (const [id, rules] of byGate) {
        if (matchesGate(id, gateId) && matchesRule(rules, rule)) {
          return true;
        }
      }
    }
  }
  return false;
}
