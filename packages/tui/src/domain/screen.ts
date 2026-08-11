/**
 * PAW TUI Renderer
 *
 * @fileoverview Render {@link TuiState} into framed screen — fixed-width
 * box with tab bar, view body, footer of keybindings. Pure and
 * deterministic (width be parameter, no terminal query), so whole screen be
 * snapshot test and regression tier from CONSTRAINTS.md Constraint 1 be
 * text-buffer diff. Doctor, plan/brief, herd bodies each read core
 * report and decorate it; domain truth (ok, blocking, released) already live
 * in core, so these only pick glyphs and layout.
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
 * Key that select each view, shown in tab bar.
 */
const TAB_KEY: Record<View, string> = {
  doctor: '1',
  plan: '2',
  herd: '3',
  gates: 'g',
  daemon: 'd',
  config: 'c',
};
import { INIT_OPTIONS, type InitPromptState } from './initPrompt.js';

/**
 * Rendered screen: rectangular block of text lines.
 *
 * @interface Screen
 * @property {string[]} lines - Screen rows, top to bottom.
 */
export interface Screen {
  readonly lines: string[];
}

const WIDTH = 72;

/**
 * Fit string to exact width: pad short string, truncate long one with
 * ellipsis so frame never break.
 *
 * @param {string} text - Content.
 * @param {number} width - Target width.
 * @returns {string} Fitted string.
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
 * Draw titled box around body and footer lines.
 *
 * @param {string} title - Box title.
 * @param {string[]} body - Body lines.
 * @param {string[]} footer - Footer lines, below separator.
 * @returns {string[]} Framed lines.
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
 * Say what found at config path, in words operator need to
 * choose between keep it and replace it.
 *
 * @param {InitConflict} conflict - What found.
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
 * Render init conflict prompt: what found, and resolutions offered.
 *
 * @param {InitPromptState} state - Prompt state.
 * @returns {Screen} Framed screen.
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
 * Render tab bar, mark active view.
 *
 * @param {View} view - Active view.
 * @returns {string} Tab line.
 */
function tabs(view: View): string {
  const names: View[] = ['doctor', 'plan', 'herd', 'gates', 'daemon', 'config'];
  return names
    .map((n) => (n === view ? `▸${TAB_KEY[n]} ${n}◂` : ` ${TAB_KEY[n]} ${n} `))
    .join(' ');
}

/**
 * Build doctor view body.
 *
 * @param {DoctorReport} report - Doctor report.
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
 * Build plan view body, include selected member's brief — TUI's
 * script-editor preview.
 *
 * @param {TuiState} state - Current state.
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
 * Build herd view body.
 *
 * @param {DispatchResult | null} herd - Dispatch result, or null before release.
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
 * Build gates view body: run in progress, prompt before first run,
 * or last run's report grouped by failing gate.
 *
 * @param {TuiState} state - Current state.
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
 * @param {readonly Violation[]} violations - Outstanding violations.
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
 * Build daemon view body: query in progress, prompt before first
 * query, not-running notice, or running daemon's status and violations
 * it holding.
 *
 * @param {TuiState} state - Current state.
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
 * Build config view body: declared models, then every role and model
 * it bound to, selected role marked.
 *
 * @param {TuiState} state - Current state.
 * @returns {string[]} Body lines.
 */
function configBody(state: TuiState): string[] {
  if (state.busy) {
    return ['Reading bindings…'];
  }
  const config = state.config;
  if (config === null) {
    return ['No bindings read yet — press c.'];
  }
  const models = config.models.length === 0 ? '(none declared)' : config.models.join(', ');
  const lines = [`models: ${models}`, ''];
  config.bindings.forEach((binding, index) => {
    const marker = index === state.role ? '▸' : ' ';
    lines.push(`${marker} ${binding.role} → ${binding.bound ?? '(unbound)'}`);
  });
  return lines;
}

/**
 * Pick body for active view.
 *
 * @param {TuiState} state - Current state.
 * @returns {string[]} Active view's body.
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
  if (state.view === 'config') {
    return configBody(state);
  }
  return herdBody(state.data.herd);
}

/**
 * Keybinding footer for active view — daemon view show own
 * actions, every other view shared navigation.
 *
 * @param {TuiState} state - Current state.
 * @returns {string[]} Footer lines.
 */
function footer(state: TuiState): string[] {
  if (state.view === 'daemon') {
    return ['d refresh · r restart · p prune · s stop · 1/2/3 views · q quit'];
  }
  if (state.view === 'config') {
    return ['j/k role · b cycle model · c refresh · 1/2/3 views · q quit'];
  }
  return ['1/2/3 view · g gates · d daemon · c config · j/k member · q quit'];
}

/**
 * Render full screen for given state.
 *
 * @param {TuiState} state - Current state.
 * @returns {Screen} Framed screen.
 */
export function render(state: TuiState): Screen {
  const body = [tabs(state.view), '', ...viewBody(state)];
  return { lines: frame('PAW', body, footer(state)) };
}
