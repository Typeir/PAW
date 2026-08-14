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
  ConnectorRosterRow,
  DispatchResult,
  DoctorFinding,
  DoctorReport,
  HealthReport,
  SwarmPlan,
  Violation,
} from '@paw/core';
import { renderBrief } from '@paw/core';
import { ansiPaint } from '@paw/cosmetics';

const GATE_FINDING_CAP = 25;
const VIOLATION_CAP = 40;

/**
 * Semantic painters from the shared palette, so cli, tui, and gui render one
 * color language.
 */
const PAINT = ansiPaint;

/**
 * Paint one help line: `[optional]` amber italic, `<param>` sage italic, hook
 * event names cyan bold, PAW concepts (pawd, `.paw/` paths, `.swarm.mjs`) cyan,
 * cross-domain tech terms (TLS, JSON) muted magenta, `--flag` grey, the leading
 * command verb bold. One combined pass, first match wins, so tokens never nest;
 * longer path tokens sit before their prefixes.
 *
 * @param {string} line - Plain help line.
 * @returns {string} Painted line.
 */
function paintHelpLine(line: string): string {
  const tokens = line.replace(
    /(\[[^\]]*\])|(<[^>]*>)|(tool\.pre|tool\.post|prompt\.submitted|session\.end)|(\.paw\/config\.json|\.swarm\.mjs|\.paw\/|\bpawd\b)|(\bTLS\b|\bJSON\b)|(--[a-z][a-z-]*)/g,
    (_match, optional: string, param: string, event: string, concept: string, tech: string, flag: string) => {
      if (optional !== undefined) {
        return PAINT.optional(optional);
      }
      if (param !== undefined) {
        return PAINT.param(param);
      }
      if (event !== undefined) {
        return PAINT.event(event);
      }
      if (concept !== undefined) {
        return PAINT.concept(concept);
      }
      if (tech !== undefined) {
        return PAINT.tech(tech);
      }
      return PAINT.flag(flag);
    },
  );
  return tokens
    .replace(/^ {2}([a-z][a-z-]*)/, (_m, verb: string) => `  ${PAINT.verb(verb)}`)
    .replace(/^paw /, `${PAINT.verb('paw')} `);
}

/**
 * Render the command list `paw` with no command prints. Painted with ANSI when
 * `color` is true; the caller decides from the stream (TTY, `NO_COLOR`).
 *
 * @param {boolean} [color] - Paint the lines with ANSI styles.
 * @returns {string[]} Usage lines.
 */
export function formatHelp(color = false): string[] {
  const lines = [
    'paw — agent enforcement and swarm orchestration',
    '',
    'usage: paw <command> [args]',
    '',
    '  check                          read a tool call as JSON on stdin, print allow or block (exit 0/2)',
    '  hook --copilot <event>         entry point the editor agent hooks call; runs enforcement for',
    '                                 one event: tool.pre, tool.post, prompt.submitted, session.end',
    '  daemon status|stop             show or stop the background PAW process (pawd) for this repository',
    '  gates [--staged] [files…]      run the quality gates on changed files, report violations',
    '  init [--merge|--override]      set up PAW in this repository (writes .paw/ and the hook config)',
    '  sync                           re-run init, keeping existing config',
    '  violations [--prune [file]]    list recorded violations, or clear them',
    '  config <get|set> …             read or edit model and role bindings in .paw/config.json',
    '  connectors [enable|disable <id>]  list the connector catalogue, or turn one on or off',
    '  doctor <config.json>           check a config file: every role bound to a capable model',
    '  swarm doctor|show|run <plan>   validate, preview, or run a multi-agent swarm plan (.swarm.mjs)',
    '    run flags: --live --full --ui --context a,b --concurrency N --max-tokens N',
    '  ui [plan.swarm.mjs]            start the console for this repository: desktop shell,',
    '                                 browser as fallback; --headless only prints the URL',
    '    flags: --run --live --headless --control --port N --root DIR --attach <pid>',
    '  tui [config.json] [plan]       open the keyboard-driven terminal console',
    '  trust [--dry-run]              trust the local TLS certificate, so browsers open the console',
    '                                 without a warning',
    '',
    'paw help prints this list.',
  ];
  return color ? lines.map(paintHelpLine) : lines;
}

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
 * Render the connector roster, enabled state first on each row.
 *
 * @param {readonly ConnectorRosterRow[]} roster - Catalogue with enabled state.
 * @returns {string[]} Terminal lines.
 */
export function formatConnectors(roster: readonly ConnectorRosterRow[]): string[] {
  const on = roster.filter((row) => row.enabled).length;
  return [
    `connectors: ${on} of ${roster.length} enabled`,
    ...roster.map(
      (row) => `  ${row.enabled ? 'on ' : 'off'} ${row.id} · ${row.kind} · ${row.description}`,
    ),
  ];
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
