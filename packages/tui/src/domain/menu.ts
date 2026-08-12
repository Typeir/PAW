/**
 * PAW TUI Menu Domain
 *
 * @fileoverview The menu the clack shell drives and the pure line builders each
 * action prints. The TUI is a guided front for the CLI: every action names the
 * CLI command that does the same thing, so the menu teaches the verbs it wraps.
 * Data shapes mirror the loaders in `infrastructure/main.ts`; no I/O here.
 *
 * @module @paw/tui/domain/menu
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  memberCount,
  planKey,
  renderBrief,
  type DispatchResult,
  type SwarmPlan,
  type Violation,
} from '@paw/core';
import type { DoctorReport, HealthReport } from '@paw/core';

const GATE_FINDING_CAP = 8;
const VIOLATION_FILE_CAP = 8;

/**
 * Resident daemon self-report, same shape as `daemon.status` return.
 *
 * @interface DaemonStatus
 * @property {number} pid - Daemon process id.
 * @property {number} uptimeMs - Milliseconds since daemon start.
 * @property {string} health - Daemon health word.
 * @property {string} projectRoot - Repository daemon serve.
 */
export interface DaemonStatus {
  readonly pid: number;
  readonly uptimeMs: number;
  readonly health: string;
  readonly projectRoot: string;
}

/**
 * One look at daemon: running or not, plus violations it hold.
 *
 * @interface DaemonSnapshot
 * @property {DaemonStatus | null} status - Daemon self-report, or null when none run.
 * @property {Violation[]} violations - Violations it hold.
 */
export interface DaemonSnapshot {
  readonly status: DaemonStatus | null;
  readonly violations: readonly Violation[];
}

/**
 * One role and model it bound to, or null when unbound.
 *
 * @interface ConfigBinding
 * @property {string} role - Role id.
 * @property {string | null} bound - Model it bound to, or null.
 */
export interface ConfigBinding {
  readonly role: string;
  readonly bound: string | null;
}

/**
 * Repo model bindings as config view edit them.
 *
 * @interface ConfigSnapshot
 * @property {string[]} models - Declared model ids.
 * @property {ConfigBinding[]} bindings - One entry per role.
 */
export interface ConfigSnapshot {
  readonly models: readonly string[];
  readonly bindings: readonly ConfigBinding[];
}

/**
 * Data the shell load once for read-only actions.
 *
 * @interface TuiData
 * @property {DoctorReport} doctor - Unified doctor report.
 * @property {SwarmPlan<unknown>} plan - Loaded swarm plan.
 * @property {DispatchResult | null} herd - Dispatch result, or null before release.
 */
export interface TuiData {
  readonly doctor: DoctorReport;
  readonly plan: SwarmPlan<unknown>;
  readonly herd: DispatchResult | null;
}

/**
 * Action ids the menu offer. Batch mode reads these same ids off stdin.
 */
export type ActionId = 'doctor' | 'plan' | 'herd' | 'gates' | 'daemon' | 'config' | 'quit';

/**
 * One menu entry.
 *
 * @interface MenuEntry
 * @property {ActionId} id - Action id; batch token.
 * @property {string} label - What the picker shows.
 * @property {string} hint - One-line description under the label.
 * @property {string | null} cli - CLI command that does the same thing; the line each action prints so the menu teaches the verb. Null for quit.
 */
export interface MenuEntry {
  readonly id: ActionId;
  readonly label: string;
  readonly hint: string;
  readonly cli: string | null;
}

/**
 * The menu, in the order the picker shows it.
 */
export const MENU: readonly MenuEntry[] = [
  {
    id: 'doctor',
    label: 'doctor',
    hint: 'is PAW ready here — config, roles, models',
    cli: 'paw doctor .paw/config.json',
  },
  {
    id: 'plan',
    label: 'plan',
    hint: 'preview a member brief of the discovered plan',
    cli: 'paw swarm show <plan.swarm.mjs> <member>',
  },
  {
    id: 'herd',
    label: 'herd',
    hint: 'the dry-run herd result for the plan',
    cli: 'paw swarm run <plan.swarm.mjs>',
  },
  {
    id: 'gates',
    label: 'gates',
    hint: 'run the quality gates on working-tree changes',
    cli: 'paw gates',
  },
  {
    id: 'daemon',
    label: 'daemon',
    hint: 'status of the resident pawd and its violations',
    cli: 'paw daemon status',
  },
  {
    id: 'config',
    label: 'config',
    hint: 'role → model bindings in .paw/config.json',
    cli: 'paw config',
  },
  { id: 'quit', label: 'quit', hint: 'leave', cli: null },
];

/**
 * Doctor lines: readiness, config problems, one row per role.
 *
 * @param {DoctorReport} report - Doctor report.
 * @returns {string[]} Lines.
 */
export function doctorLines(report: DoctorReport): string[] {
  const lines = [report.ok ? 'PAW is ready.' : 'PAW is NOT ready.', ''];
  for (const problem of report.config) {
    lines.push(`✗ config.${problem.field} — ${problem.message}`);
  }
  for (const row of report.roles) {
    const bound = row.boundTo ?? '(unbound)';
    const why =
      row.satisfaction && !row.satisfaction.ok
        ? ` (${row.satisfaction.reasons.join('; ')})`
        : '';
    lines.push(`${row.blocking ? '✗' : '✓'} ${row.role} → ${bound}${why}`);
  }
  return lines;
}

/**
 * Plan lines: header, member roster, one member's brief.
 *
 * @param {SwarmPlan<unknown>} plan - The plan.
 * @param {number} member - Member whose brief prints.
 * @returns {string[]} Lines.
 */
export function planLines(plan: SwarmPlan<unknown>, member: number): string[] {
  const count = memberCount(plan);
  const lines = [`plan: ${plan.name} · role ${plan.role} · ${count} members`, ''];
  for (let m = 0; m < count; m += 1) {
    lines.push(`${m === member ? '▸' : ' '} member ${m} — ${planKey(plan, m)}`);
  }
  lines.push('', `── brief · member ${member} ──`);
  lines.push(...renderBrief(plan, member).split('\n'));
  return lines;
}

/**
 * Herd lines: counts and one line per outcome; refusal lines when the doctor
 * refused release; a notice before any release.
 *
 * @param {DispatchResult | null} herd - Dispatch result, or null.
 * @returns {string[]} Lines.
 */
export function herdLines(herd: DispatchResult | null): string[] {
  if (herd === null) {
    return ['No herd released yet.'];
  }
  if (!herd.released) {
    const lines = ['Release REFUSED.', ''];
    for (const f of herd.findings) {
      lines.push(`${f.ok ? '✓' : '✗'} ${f.check}${f.detail ? ` — ${f.detail}` : ''}`);
    }
    return lines;
  }
  const done = herd.outcomes.filter((o) => o.state === 'done').length;
  const lines = [`${done} done · ${herd.outcomes.length - done} skipped`, ''];
  for (const o of herd.outcomes) {
    lines.push(`${o.state === 'done' ? '✓' : '·'} member ${o.member} (${o.key})`);
  }
  return lines;
}

/**
 * Gate lines: summary, failing gates with capped findings, clean notice when
 * everything passed.
 *
 * @param {HealthReport} report - Gate run report.
 * @returns {string[]} Lines.
 */
export function gatesLines(report: HealthReport): string[] {
  const { summary } = report;
  const lines = [
    `${report.overall} · ${summary.passed}/${summary.totalGates} gate(s) · ${summary.totalFindings} finding(s)`,
    '',
  ];
  for (const gate of report.gates) {
    if (gate.passed) {
      continue;
    }
    lines.push(`✗ ${gate.gate} (${gate.severity}) — ${gate.findings.length}`);
    for (const finding of gate.findings.slice(0, GATE_FINDING_CAP)) {
      const at = finding.line !== undefined ? `${finding.file}:${finding.line}` : finding.file;
      lines.push(`   ${at}  ${finding.rule}`);
    }
    if (gate.findings.length > GATE_FINDING_CAP) {
      lines.push(`   …and ${gate.findings.length - GATE_FINDING_CAP} more`);
    }
  }
  if (report.gates.every((gate) => gate.passed)) {
    lines.push('✓ all gates clean');
  }
  return lines;
}

/**
 * Outstanding violations grouped by file, capped.
 *
 * @param {readonly Violation[]} violations - Outstanding violations.
 * @returns {string[]} Lines.
 */
function violationLines(violations: readonly Violation[]): string[] {
  const byFile = new Map<string, Set<string>>();
  for (const v of violations) {
    const rules = byFile.get(v.filePath) ?? new Set<string>();
    rules.add(v.rule);
    byFile.set(v.filePath, rules);
  }
  const files = [...byFile.entries()];
  const lines = [`${violations.length} outstanding across ${files.length} file(s):`, ''];
  for (const [file, rules] of files.slice(0, VIOLATION_FILE_CAP)) {
    lines.push(`✗ ${file}  (${[...rules].join(', ')})`);
  }
  if (files.length > VIOLATION_FILE_CAP) {
    lines.push(`…and ${files.length - VIOLATION_FILE_CAP} more file(s)`);
  }
  return lines;
}

/**
 * Daemon lines: not-running notice, or status plus held violations.
 *
 * @param {DaemonSnapshot} snapshot - Daemon look.
 * @returns {string[]} Lines.
 */
export function daemonLines(snapshot: DaemonSnapshot): string[] {
  if (snapshot.status === null) {
    return ['No daemon is running for this repository.'];
  }
  const { status, violations } = snapshot;
  const lines = [
    `● running · pid ${status.pid} · up ${Math.floor(status.uptimeMs / 1000)}s · ${status.health}`,
    '',
  ];
  if (violations.length === 0) {
    lines.push('No outstanding violations.');
    return lines;
  }
  lines.push(...violationLines(violations));
  return lines;
}

/**
 * Config lines: declared models, one row per role binding.
 *
 * @param {ConfigSnapshot} config - Bindings snapshot.
 * @returns {string[]} Lines.
 */
export function configLines(config: ConfigSnapshot): string[] {
  const models = config.models.length === 0 ? '(none declared)' : config.models.join(', ');
  const lines = [`models: ${models}`, ''];
  for (const binding of config.bindings) {
    lines.push(`  ${binding.role} → ${binding.bound ?? '(unbound)'}`);
  }
  return lines;
}
