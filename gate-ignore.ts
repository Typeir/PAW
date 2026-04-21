/**
 * PAW Gate Ignore Directives
 *
 * @fileoverview Parses `paw:gate:` ignore directives from source files and
 * filters gate findings accordingly. This module is part of the PAW framework
 * core and has no project-specific knowledge.
 *
 * Supported syntax (works in any comment style):
 *
 *   TypeScript / JS:  `/ * paw:gate:{id} ignore * /`
 *   Rule-scoped:      `/ * paw:gate:{id}:{rule} ignore * /`
 *   Next-line only:   `/ * paw:gate:{id} ignore-nextline * /`
 *   MDX JSX comment:  `{/ * paw:gate:{id}:{rule} ignore * /}`
 *   HTML / MDX:       `<!-- paw:gate:{id} ignore -->`
 *   All gates:        `/ * paw:gate:* ignore * /`
 *   All rules:        `/ * paw:gate:{id}:* ignore * /`
 *
 * Gate IDs and rule IDs are case-insensitive.
 * `*` is the wildcard that matches any gate or any rule.
 *
 * @module .github/PAW/gate-ignore
 * @author Typeir
 * @version 1.0.0
 * @since 3.0.0
 */

import type { GateFinding } from './health-check-types';

/**
 * Pattern matching any `paw:gate:` ignore directive.
 *
 * Capture groups:
 *   1 — gate ID (or `*`)
 *   2 — rule ID (optional, or `*`)
 *   3 — directive mode: `ignore` or `ignore-nextline`
 */
const DIRECTIVE_PATTERN =
  /(?:\/\*|\{\/\*|<!--)\s*paw:gate:([\w*-]+)(?::([\w*-]+))?\s+(ignore(?:-nextline)?)\s*(?:\*\/|\*\/\}|-->)/gi;

/**
 * Parsed ignore directives for a single file.
 *
 * @interface FileIgnoreDirectives
 * @property {Map<string, Set<string>>} fileLevel - Gate ID → suppressed rule IDs (`*` = all)
 * @property {Map<number, Map<string, Set<string>>>} nextLine - 1-based target line → gate ID → rule IDs
 */
interface FileIgnoreDirectives {
  /** Gate ID → suppressed rule IDs (`'*'` = all rules suppressed for that gate) */
  fileLevel: Map<string, Set<string>>;
  /** 1-based target line number → gate ID → suppressed rule IDs */
  nextLine: Map<number, Map<string, Set<string>>>;
}

/**
 * Parse all `paw:gate:` ignore directives from a file's source text.
 *
 * @param {string} content - Full file source
 * @returns {FileIgnoreDirectives} Parsed directive sets
 */
function parseDirectives(content: string): FileIgnoreDirectives {
  const result: FileIgnoreDirectives = {
    fileLevel: new Map(),
    nextLine: new Map(),
  };

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    DIRECTIVE_PATTERN.lastIndex = 0;

    for (const match of lines[i].matchAll(DIRECTIVE_PATTERN)) {
      const gateId = match[1].toLowerCase();
      const rule = match[2]?.toLowerCase() ?? '*';
      const mode = match[3];

      if (mode === 'ignore') {
        if (!result.fileLevel.has(gateId)) {
          result.fileLevel.set(gateId, new Set());
        }
        result.fileLevel.get(gateId)!.add(rule);
      } else {
        const targetLine = i + 2;
        if (!result.nextLine.has(targetLine)) {
          result.nextLine.set(targetLine, new Map());
        }
        const lineMap = result.nextLine.get(targetLine)!;
        if (!lineMap.has(gateId)) {
          lineMap.set(gateId, new Set());
        }
        lineMap.get(gateId)!.add(rule);
      }
    }
  }

  return result;
}

/**
 * Test whether a gate finding is suppressed by the parsed directives.
 *
 * @param {FileIgnoreDirectives} directives - Parsed directives for the finding's file
 * @param {string} gateId - ID of the gate producing the finding
 * @param {string} rule - Rule identifier within that gate
 * @param {number | undefined} line - 1-based line number of the finding
 * @returns {boolean} True when the finding should be removed
 */
function isSuppressed(
  directives: FileIgnoreDirectives,
  gateId: string,
  rule: string,
  line: number | undefined,
): boolean {
  const matchesGate = (id: string): boolean => id === '*' || id === gateId;
  const matchesRule = (rules: Set<string>): boolean =>
    rules.has('*') || rules.has(rule);

  for (const [id, rules] of directives.fileLevel) {
    if (matchesGate(id) && matchesRule(rules)) return true;
  }

  if (typeof line === 'number') {
    const lineMap = directives.nextLine.get(line);
    if (lineMap) {
      for (const [id, rules] of lineMap) {
        if (matchesGate(id) && matchesRule(rules)) return true;
      }
    }
  }

  return false;
}

/**
 * Filter gate findings by applying `paw:gate:` ignore directives from each
 * finding's source file.
 *
 * Each unique file is read exactly once; results are cached for the call duration.
 * Read errors are silently ignored (the finding is kept).
 *
 * @param {string} gateId - ID of the gate whose findings are being filtered
 * @param {GateFinding[]} findings - Raw findings returned by the gate
 * @param {(relativePath: string) => Promise<string>} readFile - File reader backed by GateContext cache
 * @returns {Promise<GateFinding[]>} Findings with all suppressed entries removed
 */
export async function filterGateFindings(
  gateId: string,
  findings: GateFinding[],
  readFile: (relativePath: string) => Promise<string>,
): Promise<GateFinding[]> {
  if (findings.length === 0) return findings;

  const uniqueFiles = [...new Set(findings.map((f) => f.file).filter(Boolean))];
  const directivesByFile = new Map<string, FileIgnoreDirectives>();

  await Promise.all(
    uniqueFiles.map(async (file) => {
      try {
        const content = await readFile(file);
        directivesByFile.set(file, parseDirectives(content));
      } catch {
        directivesByFile.set(file, {
          fileLevel: new Map(),
          nextLine: new Map(),
        });
      }
    }),
  );

  return findings.filter((finding) => {
    const directives = directivesByFile.get(finding.file);
    if (!directives) return true;
    return !isSuppressed(directives, gateId, finding.rule, finding.line);
  });
}
