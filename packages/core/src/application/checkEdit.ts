/**
 * PAW Post-Tool Detector
 *
 * @fileoverview `tool.post` half of enforcement loop. Detector feed pre-tool
 * decision. Run project gates against files tool just changed, clear each file
 * stale violations, record fresh critical ones, return `block`.
 * `decidePreToolUse` consume that record on next `tool.pre`. Port from legacy
 * `postToolUse` hook, wired to {@link GateRunner} and {@link StorePort}.
 *
 * @module @paw/core/application/checkEdit
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ToolPostEvent, PawResponse } from '../domain/event.js';
import type { GateFinding } from '../domain/gate.js';
import { lintViolation } from '../domain/linters.js';
import type { GateRunner, LinterRunner, StorePort } from '../ports/index.js';
import { truncate, type Violation } from '../domain/violation.js';

const MAX_RULE_LINES = 12;
const MAX_MESSAGE = 160;

/**
 * Detector need these.
 *
 * @interface CheckEditDeps
 * @property {StorePort} store - Clear violation there, record there.
 * @property {GateRunner} gates - Run project gates against edited files.
 * @property {(path: string) => boolean} isIgnored - Path pawignored? skip it.
 * @property {LinterRunner} [linters] - Run enabled linter connectors on the same files; findings recorded deferred. Omit to run no linters.
 */
export interface CheckEditDeps {
  readonly store: StorePort;
  readonly gates: GateRunner;
  readonly isIgnored: (path: string) => boolean;
  readonly linters?: LinterRunner;
}

/**
 * Critical findings from report: failed gate + effective critical severity.
 *
 * @param {Awaited<ReturnType<GateRunner['runForFiles']>>} report - Gate run.
 * @returns {GateFinding[]} Blocking findings.
 */
function criticalFindings(
  report: Awaited<ReturnType<GateRunner['runForFiles']>>,
): GateFinding[] {
  return report.gates
    .filter((g) => !g.passed && g.severity === 'critical')
    .flatMap((g) => g.findings);
}

/**
 * Finding as unrecorded violation: store assign id later.
 *
 * @param {GateFinding} f - Gate finding.
 * @returns {Violation} Violation to raise.
 */
function toViolation(f: GateFinding): Violation {
  return {
    id: 0,
    filePath: f.file,
    rule: f.rule,
    message: f.message,
    indirectFix: f.indirectFix ?? false,
  };
}

/**
 * Clip message; add ellipsis when pass max.
 *
 * @param {string} text - Finding message.
 * @returns {string} Message clipped, ellipsis when long.
 */
function clip(text: string): string {
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;
}

/**
 * Build block reason, one line per rule: count + sample. Capped both ways
 * (rule lines, total length).
 *
 * @param {readonly GateFinding[]} findings - Critical findings.
 * @returns {string} Bounded per-rule block reason.
 */
function formatFindings(findings: readonly GateFinding[]): string {
  const byRule = new Map<string, GateFinding[]>();
  for (const f of findings) {
    const group = byRule.get(f.rule);
    if (group) {
      group.push(f);
    } else {
      byRule.set(f.rule, [f]);
    }
  }
  const rules = [...byRule.entries()];
  const lines = rules.slice(0, MAX_RULE_LINES).map(([rule, group]) => {
    const first = group[0];
    const at = `${first.file}${first.line !== undefined ? `:${first.line}` : ''}`;
    return group.length > 1
      ? `- ${rule} ×${group.length}: ${clip(first.message)} (e.g. ${at})`
      : `- ${rule}: ${clip(first.message)} (${at})`;
  });
  if (rules.length > MAX_RULE_LINES) {
    lines.push(`- …and ${rules.length - MAX_RULE_LINES} more rule type(s)`);
  }
  const header = `Fix these before continuing — ${findings.length} gate violation(s) across ${rules.length} rule type(s):`;
  return truncate(`${header}\n${lines.join('\n')}`);
}

/**
 * Run gates against files tool changed; record outcome.
 *
 * @param {CheckEditDeps} deps - Detector dependencies.
 * @param {ToolPostEvent} event - Post-tool event.
 * @returns {Promise<PawResponse>} `block` with findings, or `noop` when clean.
 *
 * @description
 * Ignored paths skipped. Clear each gated file stale violations first,
 * then record critical gate findings and any linter findings, and return
 * `block`; clean run record nothing and return `noop`. Only critical gate
 * findings decide the block — linter findings are deferred, so a run whose
 * findings are all lint records them and returns `noop`, and they nudge on
 * the next `tool.pre`.
 */
export async function checkEdit(
  deps: CheckEditDeps,
  event: ToolPostEvent,
): Promise<PawResponse> {
  const paths = event.editedPaths.filter((p) => !deps.isIgnored(p));
  if (paths.length === 0) {
    return { kind: 'noop' };
  }

  const report = await deps.gates.runForFiles(paths);
  const findings = criticalFindings(report);
  const lint = deps.linters ? await deps.linters.runForFiles(paths) : [];

  for (const p of paths) {
    await deps.store.resolveForFile(p, event.sessionId);
  }

  const raised = [...findings.map(toViolation), ...lint.map(lintViolation)];
  if (raised.length > 0) {
    await deps.store.raise(raised, event.sessionId);
  }

  if (findings.length === 0) {
    return { kind: 'noop' };
  }
  return { kind: 'block', reason: formatFindings(findings) };
}
