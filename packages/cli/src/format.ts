/**
 * PAW CLI Formatters
 *
 * @fileoverview Pure renderings of core reports into terminal lines — the
 * doctor, the swarm plan doctor, a member's brief (the script editor's preview
 * in the terminal), and a herd result. No I/O; these own the CLI's coverage.
 * The process shell in `main.ts` loads files, calls core, and prints what these
 * return.
 *
 * @module @paw/cli/format
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type {
  DispatchResult,
  DoctorFinding,
  DoctorReport,
  SwarmPlan,
} from '@paw/core';
import { renderBrief } from '@paw/core';

/**
 * Render a mark for a boolean status.
 *
 * @param {boolean} ok - The status.
 * @returns {string} `✓` or `✗`.
 */
function mark(ok: boolean): string {
  return ok ? '✓' : '✗';
}

/**
 * Render the unified doctor report.
 *
 * @param {DoctorReport} report - The report from `runDoctor`.
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
 * Render a swarm plan's doctor findings.
 *
 * @param {string} name - The plan name.
 * @param {DoctorFinding[]} findings - The findings from `doctorPlan`.
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
 * Render one member's brief — the terminal form of the GUI's brief preview.
 * Callers that have composed the dispatched prompt (a brief plus its attached
 * context) pass it in, so the dry-run shows what would actually be sent rather
 * than the brief alone.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {number} member - Zero-based member index.
 * @param {string} [text] - The text to show; defaults to the member's rendered brief.
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
 * Render a herd dispatch result.
 *
 * @param {DispatchResult} result - The result from `dispatchSwarm`.
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
