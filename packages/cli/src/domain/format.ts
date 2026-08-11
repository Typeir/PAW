/**
 * PAW CLI Formatters
 *
 * @fileoverview Render core reports to terminal lines: doctor, swarm plan
 * doctor, member brief, herd result. No I/O. Process shell in `main.ts` load
 * files, call core, print what these return.
 *
 * @module @paw/cli/domain/format
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type {
  DispatchResult,
  DoctorFinding,
  DoctorReport,
  HealthReport,
  SwarmPlan,
  Violation,
} from '@paw/core';
import { renderBrief } from '@paw/core';

const GATE_FINDING_CAP = 25;
const VIOLATION_CAP = 40;

/**
 * Render mark for boolean status.
 *
 * @param {boolean} ok - The status.
 * @returns {string} `✓` or `✗`.
 */
function mark(ok: boolean): string {
  return ok ? '✓' : '✗';
}

/**
 * Render unified doctor report.
 *
 * @param {DoctorReport} report - Report from `runDoctor`.
 * @returns {string[]} Terminal lines.
 */
export function formatDoctor(report: DoctorReport): string[] {
  const lines = [`doctor: ${report.ok ? 'ready' : 'NOT READY'}`];
  for (const problem of report.config) {
    lines.push(`  ✗ config.${problem.field}: ${problem.message}`);
  }
  for (const row of report.roles) {
    const bound = row.boundTo ?? '(unbound)';
    const ok = !row.blocking;
    const detail = row.satisfaction && !row.satisfaction.ok
      ? ` — ${row.satisfaction.reasons.join('; ')}`
      : '';
    lines.push(`  ${mark(ok)} role ${row.role} → ${bound}${detail}`);
  }
  return lines;
}

/**
 * Render gate run's health report as terminal lines: one-line summary, then
 * each failing gate with its findings, capped.
 *
 * @param {HealthReport} report - Report from gate runner.
 * @returns {string[]} Terminal lines.
 */
export function formatGateReport(report: HealthReport): string[] {
  const { summary } = report;
  const lines = [
    `gates: ${report.overall} · ${summary.passed}/${summary.totalGates} gate(s) · ${summary.totalFindings} finding(s)`,
  ];
  for (const gate of report.gates) {
    if (gate.passed) {
      continue;
    }
    lines.push(`  ${mark(false)} ${gate.gate} (${gate.severity}) — ${gate.findings.length} finding(s)`);
    for (const finding of gate.findings.slice(0, GATE_FINDING_CAP)) {
      const at = finding.line !== undefined ? `${finding.file}:${finding.line}` : finding.file;
      lines.push(`      ${at}  ${finding.rule}: ${finding.message}`);
    }
    if (gate.findings.length > GATE_FINDING_CAP) {
      lines.push(`      …and ${gate.findings.length - GATE_FINDING_CAP} more`);
    }
  }
  if (report.overall === 'PASS') {
    lines.push(`  ${mark(true)} all gates clean`);
  }
  return lines;
}

/**
 * Render outstanding-violations list, group by file, cap. Null result mean no
 * daemon answer.
 *
 * @param {{ violations?: Violation[] } | null} result - The `violations.list` reply.
 * @returns {string[]} Terminal lines.
 */
export function formatViolations(result: { violations?: Violation[] } | null): string[] {
  if (result === null) {
    return ['violations: no daemon is running for this repository'];
  }
  const violations = result.violations ?? [];
  if (violations.length === 0) {
    return ['violations: none outstanding'];
  }
  const byFile = new Map<string, Violation[]>();
  for (const v of violations) {
    const group = byFile.get(v.filePath) ?? [];
    group.push(v);
    byFile.set(v.filePath, group);
  }
  const lines = [`violations: ${violations.length} outstanding across ${byFile.size} file(s)`];
  let shown = 0;
  for (const [file, group] of byFile) {
    if (shown >= VIOLATION_CAP) {
      break;
    }
    lines.push(`  ${file}`);
    for (const v of group) {
      if (shown >= VIOLATION_CAP) {
        break;
      }
      lines.push(`    ${v.rule}: ${v.message}`);
      shown += 1;
    }
  }
  if (violations.length > shown) {
    lines.push(`  …and ${violations.length - shown} more`);
  }
  return lines;
}

/**
 * Render outcome of prune. Null result mean no daemon answer.
 *
 * @param {{ cleared?: number } | null} result - The `violations.prune` reply.
 * @param {string | null} file - File pruned, or null for all files.
 * @returns {string[]} Terminal lines.
 */
export function formatPruned(result: { cleared?: number } | null, file: string | null): string[] {
  if (result === null) {
    return ['prune: no daemon is running for this repository'];
  }
  return [`pruned ${result.cleared ?? 0} violation(s) — ${file ?? 'all files'}`];
}

/**
 * Render swarm plan's doctor findings.
 *
 * @param {string} name - The plan name.
 * @param {DoctorFinding[]} findings - Findings from `doctorPlan`.
 * @returns {string[]} Terminal lines.
 */
export function formatPlanDoctor(
  name: string,
  findings: DoctorFinding[],
): string[] {
  const ok = findings.every((f) => f.ok);
  const lines = [`plan ${name}: ${ok ? 'ok' : 'REFUSED'}`];
  for (const f of findings) {
    lines.push(`  ${mark(f.ok)} ${f.check}${f.detail ? ` — ${f.detail}` : ''}`);
  }
  return lines;
}

/**
 * Render one member's brief — terminal form of GUI's brief preview.
 * Callers pass composed dispatched prompt (brief plus attached context), or
 * fall back to member's rendered brief.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number} member - Zero-based member index.
 * @param {string} [text] - Text to show; default member's rendered brief.
 * @returns {string[]} The brief, header then body lines.
 */
export function formatBrief<A>(
  plan: SwarmPlan<A>,
  member: number,
  text: string = renderBrief(plan, member),
): string[] {
  return [`── ${plan.name} · member ${member} ──`, ...text.split('\n')];
}

/**
 * Render herd dispatch result.
 *
 * @param {DispatchResult} result - Result from `dispatchSwarm`.
 * @returns {string[]} Terminal lines.
 */
export function formatHerd(result: DispatchResult): string[] {
  if (!result.released) {
    return formatPlanDoctor('(release refused)', result.findings);
  }
  const done = result.outcomes.filter((o) => o.state === 'done').length;
  const skipped = result.outcomes.length - done;
  const lines = [`herd: ${done} done · ${skipped} skipped`];
  for (const o of result.outcomes) {
    lines.push(`  ${o.state === 'done' ? '✓' : '·'} member ${o.member} (${o.key})`);
  }
  return lines;
}
