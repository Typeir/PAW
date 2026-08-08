/**
 * PAW Post-Tool Detector
 *
 * @fileoverview The `tool.post` half of the enforcement loop — the detector that
 * feeds the pre-tool decision. It runs the project's gates against the files a
 * tool just changed, clears each file's stale violations, records the fresh
 * critical ones, and returns a `block` so the host surfaces them. It does not
 * gate future tools; `decidePreToolUse` does that on the next `tool.pre`, reading
 * exactly what this recorded. Ported from the legacy `postToolUse` hook, wired to
 * the {@link GateRunner} and {@link StorePort} rather than to SQLite directly.
 *
 * @module @paw/core/application/checkEdit
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ToolPostEvent, PawResponse } from '../domain/event.js';
import type { GateFinding } from '../domain/gate.js';
import type { GateRunner, StorePort } from '../ports/index.js';
import type { Violation } from '../domain/violation.js';

/**
 * What the detector needs.
 *
 * @interface CheckEditDeps
 * @property {StorePort} store - Where violations are cleared and recorded.
 * @property {GateRunner} gates - Runs the project's gates against the edited files.
 * @property {(path: string) => boolean} isIgnored - Whether a path is pawignored (skipped).
 */
export interface CheckEditDeps {
  readonly store: StorePort;
  readonly gates: GateRunner;
  readonly isIgnored: (path: string) => boolean;
}

/**
 * The critical findings from a report — those from a failed gate whose effective
 * severity is critical, mirroring the legacy hook's block condition.
 *
 * @param {Awaited<ReturnType<GateRunner['runForFiles']>>} report - The gate run.
 * @returns {GateFinding[]} The blocking findings.
 */
function criticalFindings(
  report: Awaited<ReturnType<GateRunner['runForFiles']>>,
): GateFinding[] {
  return report.gates
    .filter((g) => !g.passed && g.severity === 'critical')
    .flatMap((g) => g.findings);
}

/**
 * A finding as an unrecorded violation the store will assign an id to.
 *
 * @param {GateFinding} f - The gate finding.
 * @returns {Violation} The violation to raise.
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
 * The block reason listing each finding, one per line.
 *
 * @param {readonly GateFinding[]} findings - The critical findings.
 * @returns {string} A multi-line reason shown to the agent.
 */
function formatFindings(findings: readonly GateFinding[]): string {
  const lines = findings.map((f) => {
    const loc = f.line !== undefined ? `:${f.line}` : '';
    return `- [${f.rule}] ${f.message} (${f.file}${loc})`;
  });
  return `Gate violations must be fixed before continuing:\n${lines.join('\n')}`;
}

/**
 * Run the gates against the files a tool changed and record the outcome.
 *
 * @param {CheckEditDeps} deps - The detector dependencies.
 * @param {ToolPostEvent} event - The post-tool event.
 * @returns {Promise<PawResponse>} `block` with the findings, or `noop` when clean.
 *
 * @description
 * Ignored paths are skipped. Each gated file's stale violations are cleared first
 * (a re-run is the fresh truth), then the critical findings are recorded and a
 * `block` is returned; a clean run records nothing and returns `noop`.
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

  for (const p of paths) {
    await deps.store.resolveForFile(p, event.sessionId);
  }

  if (findings.length === 0) {
    return { kind: 'noop' };
  }

  await deps.store.raise(findings.map(toViolation), event.sessionId);
  return { kind: 'block', reason: formatFindings(findings) };
}
