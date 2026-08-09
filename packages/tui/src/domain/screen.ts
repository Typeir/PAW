/**
 * PAW TUI Renderer
 *
 * @fileoverview Renders a {@link TuiState} into a framed screen — a fixed-width
 * box with a tab bar, a view body, and a footer of keybindings. Pure and
 * deterministic (width is a parameter, no terminal query), so a whole screen is
 * a snapshot test and the regression tier from CONSTRAINTS.md Constraint 1 is a
 * text-buffer diff. The doctor, plan/brief, and herd bodies each read a core
 * report and decorate it; the domain truth (ok, blocking, released) already lives
 * in core, so these only choose glyphs and layout.
 *
 * @module @paw/tui/domain/screen
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  memberCount,
  planKey,
  renderBrief,
  type DispatchResult,
  type DoctorReport,
  type InitConflict,
  type Violation,
} from '@paw/core';
import type { TuiState, View } from './app.js';

const GATE_FINDING_CAP = 8;
const VIOLATION_FILE_CAP = 8;

/**
 * The key that selects each view, shown in the tab bar.
 */
const TAB_KEY: Record<View, string> = {
  doctor: '1',
  plan: '2',
  herd: '3',
  gates: 'g',
  daemon: 'd',
};
import { INIT_OPTIONS, type InitPromptState } from './initPrompt.js';

/**
 * A rendered screen: a rectangular block of text lines.
 *
 * @interface Screen
 * @property {string[]} lines - The screen's rows, top to bottom.
 */
export interface Screen {
  readonly lines: string[];
}

const WIDTH = 72;

/**
 * Fit a string to an exact width: pad short strings, truncate long ones with an
 * ellipsis so the frame never breaks.
 *
 * @param {string} text - The content.
 * @param {number} width - The target width.
 * @returns {string} The fitted string.
 */
function fit(text: string, width: number): string {
  if (text.length === width) {
    return text;
  }
  return text.length < width
    ? text + ' '.repeat(width - text.length)
    : `${text.slice(0, width - 1)}…`;
}

/**
 * Draw a titled box around body and footer lines.
 *
 * @param {string} title - The box title.
 * @param {string[]} body - The body lines.
 * @param {string[]} footer - The footer lines, below a separator.
 * @returns {string[]} The framed lines.
 */
function frame(title: string, body: string[], footer: string[]): string[] {
  const inner = WIDTH - 4;
  const fillTop = Math.max(0, WIDTH - title.length - 5);
  const row = (s: string): string => `│ ${fit(s, inner)} │`;
  return [
    `┌─ ${title} ${'─'.repeat(fillTop)}┐`,
    ...body.map(row),
    `├${'─'.repeat(WIDTH - 2)}┤`,
    ...footer.map(row),
    `└${'─'.repeat(WIDTH - 2)}┘`,
  ];
}

/**
 * Describe what was found at the config path, in the words an operator needs to
 * choose between keeping it and replacing it.
 *
 * @param {InitConflict} conflict - What was found.
 * @returns {string[]} Body lines.
 */
function conflictBody(conflict: InitConflict): string[] {
  if (conflict.kind === 'absent') {
    return ['No config at .paw/config.json — nothing to resolve.'];
  }
  if (conflict.kind === 'unstamped') {
    return [
      '.paw/config.json exists and was not written by PAW.',
      'Merging keeps everything already declared in it.',
    ];
  }
  const edited = conflict.edited
    ? 'It has been edited since PAW wrote it.'
    : 'It is unchanged since PAW wrote it.';
  return [
    `.paw/config.json was written by PAW, version ${conflict.stamp.version}.`,
    edited,
  ];
}

/**
 * Render the init conflict prompt: what was found, and the resolutions offered.
 *
 * @param {InitPromptState} state - The prompt state.
 * @returns {Screen} The framed screen.
 */
export function renderInitPrompt(state: InitPromptState): Screen {
  const options = INIT_OPTIONS.map((option, index) => {
    const mark = index === state.cursor ? '›' : ' ';
    return `${mark} ${option.label.padEnd(9)} ${option.detail}`;
  });
  return {
    lines: frame(
      'paw init',
      [...conflictBody(state.conflict), '', ...options],
      ['↑/↓ or j/k  move    ⏎ choose    esc cancel'],
    ),
  };
}

/**
 * Render the tab bar, marking the active view.
 *
 * @param {View} view - The active view.
 * @returns {string} The tab line.
 */
function tabs(view: View): string {
  const names: View[] = ['doctor', 'plan', 'herd', 'gates', 'daemon'];
  return names
    .map((n) => (n === view ? `▸${TAB_KEY[n]} ${n}◂` : ` ${TAB_KEY[n]} ${n} `))
    .join(' ');
}

/**
 * Build the doctor view body.
 *
 * @param {DoctorReport} report - The doctor report.
 * @returns {string[]} Body lines.
 */
function doctorBody(report: DoctorReport): string[] {
  const lines = [report.ok ? 'PAW is ready.' : 'PAW is NOT ready.', ''];
  for (const problem of report.config) {
    lines.push(`✗ config.${problem.field} — ${problem.message}`);
  }
  for (const row of report.roles) {
    const bound = row.boundTo ?? '(unbound)';
    const why = row.satisfaction && !row.satisfaction.ok
      ? ` (${row.satisfaction.reasons.join('; ')})`
      : '';
    lines.push(`${row.blocking ? '✗' : '✓'} ${row.role} → ${bound}${why}`);
  }
  return lines;
}

/**
 * Build the plan view body, including the selected member's brief — the TUI's
 * script-editor preview.
 *
 * @param {TuiState} state - The current state.
 * @returns {string[]} Body lines.
 */
function planBody(state: TuiState): string[] {
  const { plan } = state.data;
  const count = memberCount(plan);
  const lines = [`plan: ${plan.name} · role ${plan.role} · ${count} members`, ''];
  for (let m = 0; m < count; m += 1) {
    const marker = m === state.member ? '▸' : ' ';
    lines.push(`${marker} member ${m} — ${planKey(plan, m)}`);
  }
  lines.push('', `── brief · member ${state.member} ──`);
  lines.push(...renderBrief(plan, state.member).split('\n'));
  return lines;
}

/**
 * Build the herd view body.
 *
 * @param {DispatchResult | null} herd - The dispatch result, or null before release.
 * @returns {string[]} Body lines.
 */
function herdBody(herd: DispatchResult | null): string[] {
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
 * Build the gates view body: a run in progress, a prompt before the first run,
 * or the last run's report grouped by failing gate.
 *
 * @param {TuiState} state - The current state.
 * @returns {string[]} Body lines.
 */
function gatesBody(state: TuiState): string[] {
  if (state.busy) {
    return ['Running gates on the working-tree changes…'];
  }
  const report = state.gates;
  if (report === null) {
    return ['No gate run yet — press g to gate your changes.'];
  }
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
 * List outstanding violations grouped by file, capped, with each file's rules.
 *
 * @param {readonly Violation[]} violations - The outstanding violations.
 * @returns {string[]} Body lines.
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
 * Build the daemon view body: a query in progress, a prompt before the first
 * query, a not-running notice, or the running daemon's status and the violations
 * it is holding.
 *
 * @param {TuiState} state - The current state.
 * @returns {string[]} Body lines.
 */
function daemonBody(state: TuiState): string[] {
  if (state.busy) {
    return ['Talking to the daemon…'];
  }
  const snapshot = state.daemon;
  if (snapshot === null) {
    return ['No daemon query yet — press d.'];
  }
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
 * Select the body for the active view.
 *
 * @param {TuiState} state - The current state.
 * @returns {string[]} The active view's body.
 */
function viewBody(state: TuiState): string[] {
  if (state.view === 'doctor') {
    return doctorBody(state.data.doctor);
  }
  if (state.view === 'plan') {
    return planBody(state);
  }
  if (state.view === 'gates') {
    return gatesBody(state);
  }
  if (state.view === 'daemon') {
    return daemonBody(state);
  }
  return herdBody(state.data.herd);
}

/**
 * The keybinding footer for the active view — the daemon view shows its own
 * actions, every other view the shared navigation.
 *
 * @param {TuiState} state - The current state.
 * @returns {string[]} Footer lines.
 */
function footer(state: TuiState): string[] {
  return state.view === 'daemon'
    ? ['d refresh · p prune · s stop · 1/2/3 views · q quit']
    : ['1/2/3 view · g gates · d daemon · j/k member · q quit'];
}

/**
 * Render a full screen for the given state.
 *
 * @param {TuiState} state - The current state.
 * @returns {Screen} The framed screen.
 */
export function render(state: TuiState): Screen {
  const body = [tabs(state.view), '', ...viewBody(state)];
  return { lines: frame('PAW', body, footer(state)) };
}
