/**
 * PAW Gate-Ignore Directives
 *
 * @fileoverview Parse `paw:gate:` suppression directive from source text, see
 * if finding suppressed. Pure string work, no filesystem access — gate
 * orchestrator hands file contents. Port from legacy `gateIgnore.ts`. Split
 * work into two functions: `parseIgnoreDirectives` build directive index once
 * per file, `isSuppressed` query it per finding.
 *
 * Directive body be `paw:gate:{id}[:{rule}] (ignore|ignore-nextline)`, wrapped
 * in any comment style: TypeScript block comment, MDX JSX comment
 * (`{`-block-`}`), or HTML comment (`<!-- -->`). `ignore` suppress whole file;
 * `ignore-nextline` suppress only next line. Both gate id and optional rule id
 * be case-insensitive, `*` wildcard for either.
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
 * @property {Map<string, Set<string>>} fileLevel - Gate id → suppressed rule ids ('*' suppress all rules for that gate), apply to whole file.
 * @property {Map<number, Map<string, Set<string>>>} nextLine - 1-based target line → gate id → suppressed rule ids, apply to that line only.
 */
export interface IgnoreDirectives {
  readonly fileLevel: Map<string, Set<string>>;
  readonly nextLine: Map<number, Map<string, Set<string>>>;
}

/**
 * Build fresh directive regex. New instance per parse avoid shared
 * `lastIndex` state between calls.
 *
 * @returns {RegExp} Global, case-insensitive directive matcher.
 */
function directivePattern(): RegExp {
  return /(?:\/\*|\{\/\*|<!--)\s*paw:gate:([\w*-]+)(?::([\w*-]+))?\s+(ignore(?:-nextline)?)\s*(?:\*\/\}|\*\/|-->)/gi;
}

/**
 * Record one parsed directive into file-level or next-line index.
 *
 * @param {IgnoreDirectives} into - Index being built.
 * @param {number} lineIndex - Zero-based index of line directive on.
 * @param {string} gateId - Lower-cased gate id (or '*').
 * @param {string} rule - Lower-cased rule id (or '*').
 * @param {string} mode - `ignore` or `ignore-nextline`.
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
 * Parse all `paw:gate:` directives from file source text.
 *
 * @param {string} content - Full file source.
 * @returns {IgnoreDirectives} Parsed directive index.
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
 * Normalise id for comparison: strip dashes, lower-case. Make
 * `file-length` and `filelength` match.
 *
 * @param {string} id - Gate or rule id.
 * @returns {string} Normalised form.
 */
function normalizeId(id: string): string {
  return id.replace(/-/g, '').toLowerCase();
}

/**
 * Suppression gate id match finding gate?
 *
 * @param {string} id - Gate id from directive.
 * @param {string} gateId - Finding gate id.
 * @returns {boolean} True when they match (including `*`).
 */
function matchesGate(id: string, gateId: string): boolean {
  return id === '*' || id === gateId || normalizeId(id) === normalizeId(gateId);
}

/**
 * Directive rule set cover finding rule?
 *
 * @param {Set<string>} rules - Suppressed rule ids for gate.
 * @param {string} rule - Finding rule id.
 * @returns {boolean} True when covered (including `*`).
 */
function matchesRule(rules: Set<string>, rule: string): boolean {
  return rules.has('*') || rules.has(rule);
}

/**
 * Finding suppressed by parsed directives?
 *
 * @param {IgnoreDirectives} directives - Parsed directives for finding file.
 * @param {string} gateId - Id of gate producing finding.
 * @param {string} rule - Rule identifier within that gate.
 * @param {number} [line] - 1-based line number of finding, if known.
 * @returns {boolean} True when finding should be removed.
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
