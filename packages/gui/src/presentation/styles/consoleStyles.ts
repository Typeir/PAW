/**
 * PAW GUI Styles
 *
 * @fileoverview Console stylesheet as string, mounted by React tree. Tests
 * render the same page a user sees. Instrument-panel design from pawd-console
 * mockup: dark page with translucent glow, amber brand/running accent,
 * teal/gold/brick/slate semantic colours for done/warn/fail/idle. Colours
 * defined only in CSS custom properties, redefined for dark and light under
 * both `prefers-color-scheme` and explicit `data-theme`. Viewer OS preference
 * and in-titlebar toggle each select a theme. Monospace typography, matching
 * a control surface.
 *
 * @module @paw/gui/presentation/styles/consoleStyles
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { cssVariables } from '@paw/cosmetics';

/**
 * Full stylesheet. Inject into page, assert by tests. Semantic `--sem-*`
 * variables come from the shared palette, so cli, tui, and gui carry one color
 * language.
 *
 * @constant
 * @type {string}
 */
export const STYLES = `
:root {
  --ground: #0b0e13; --desk: #070a0e; --panel: #12171f; --panel-2: #171e27;
  --rail: #0e131a; --line: #222c39; --line-soft: #1a222d;
  --ink: #e7ecf3; --ink-dim: #93a0b2; --ink-faint: #586576;
  --accent: #e79a3c; --accent-soft: #3a2d18;
  --good: #40b498; --good-soft: #10241f; --warn: #d8b54a; --warn-soft: #2a2412;
  --crit: #d75c55; --crit-soft: #2a1613; --idle: #5c6b7e; --idle-soft: #171d26;
  --tok-key: #8ea9de; --tok-str: #86c2a6; --tok-fn: #d9b46a;
${cssVariables()}
  --mono: ui-monospace, "Cascadia Code", "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --r: 7px; --r-lg: 12px;
}
@media (prefers-color-scheme: light) {
  :root {
    --ground: #e7ebf1; --desk: #d6dce4; --panel: #ffffff; --panel-2: #f2f5f9;
    --rail: #eef2f6; --line: #d0d8e2; --line-soft: #e2e8ef;
    --ink: #182130; --ink-dim: #566576; --ink-faint: #8a97a7;
    --accent: #a9631a; --accent-soft: #f3e6d3;
    --good: #268a72; --good-soft: #dcefe9; --warn: #927617; --warn-soft: #f2ecd4;
    --crit: #b23f3a; --crit-soft: #f4ddda; --idle: #74808f; --idle-soft: #e5eaf0;
    --tok-key: #3a5b9c; --tok-str: #2f7d5f; --tok-fn: #8a6a1e;
  }
}
:root[data-theme="dark"] {
  --ground: #0b0e13; --desk: #070a0e; --panel: #12171f; --panel-2: #171e27;
  --rail: #0e131a; --line: #222c39; --line-soft: #1a222d;
  --ink: #e7ecf3; --ink-dim: #93a0b2; --ink-faint: #586576;
  --accent: #e79a3c; --accent-soft: #3a2d18;
  --good: #40b498; --good-soft: #10241f; --warn: #d8b54a; --warn-soft: #2a2412;
  --crit: #d75c55; --crit-soft: #2a1613; --idle: #5c6b7e; --idle-soft: #171d26;
  --tok-key: #8ea9de; --tok-str: #86c2a6; --tok-fn: #d9b46a;
}
:root[data-theme="light"] {
  --ground: #e7ebf1; --desk: #d6dce4; --panel: #ffffff; --panel-2: #f2f5f9;
  --rail: #eef2f6; --line: #d0d8e2; --line-soft: #e2e8ef;
  --ink: #182130; --ink-dim: #566576; --ink-faint: #8a97a7;
  --accent: #a9631a; --accent-soft: #f3e6d3;
  --good: #268a72; --good-soft: #dcefe9; --warn: #927617; --warn-soft: #f2ecd4;
  --crit: #b23f3a; --crit-soft: #f4ddda; --idle: #74808f; --idle-soft: #e5eaf0;
  --tok-key: #3a5b9c; --tok-str: #2f7d5f; --tok-fn: #8a6a1e;
}

* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background:
    radial-gradient(1200px 700px at 78% -10%, color-mix(in oklab, var(--accent) 6%, transparent), transparent 60%),
    var(--desk);
  color: var(--ink);
  font-family: var(--sans);
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
  line-height: 1.5;
}

/* One grid for whole console: bar spans both columns, rail is first column,
   main area stretches to bottom over the free row. */
[data-shell] {
  display: grid;
  grid-template-columns: 216px 1fr;
  grid-template-rows: auto 1fr;
  background: var(--ground);
  min-height: 100vh;
}
[data-shell] > header { grid-column: 1 / -1; }

/* Desktop shell renders a window; this block draws its frame. */
[data-shell="desktop"] {
  max-width: 1180px; margin: clamp(12px, 3vw, 40px) auto;
  min-height: min(640px, calc(100vh - 2 * clamp(12px, 3vw, 40px)));
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  overflow: hidden;
  box-shadow: 0 30px 70px -30px rgba(0,0,0,.7), 0 2px 0 color-mix(in oklab, var(--ink) 4%, transparent) inset;
}

[data-shell] > header {
  display: flex; align-items: center; gap: 14px;
  padding: 0 14px; height: 44px;
  background: linear-gradient(var(--panel), var(--rail));
  border-bottom: 1px solid var(--line);
}
[data-shell="desktop"] > header { -webkit-app-region: drag; }
[data-shell="desktop"] > header button { -webkit-app-region: no-drag; }
.lights { display: flex; gap: 8px; }
.lights .light { width: 12px; height: 12px; border-radius: 50%; display: block;
  border: 0; padding: 0; cursor: pointer; }
.lights .light:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.lights .close { background: #e05c54; }
.lights .minimise { background: #e0b13c; }
.lights .zoom { background: #3fb58c; }
.wordmark { display: flex; align-items: center; gap: 9px; font-family: var(--mono); }
.wordmark .mark {
  width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center;
  background: color-mix(in oklab, var(--accent) 18%, var(--panel));
  border: 1px solid color-mix(in oklab, var(--accent) 45%, transparent);
}
.wordmark .mark svg { display: block; }
.wordmark b { font-size: 13px; letter-spacing: .06em; }
.wordmark span { color: var(--ink-faint); font-size: 12px; }
.wordmark .scope { color: var(--ink-dim); max-width: 22ch; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
[data-shell] > header .daemon {
  margin-left: auto; display: flex; align-items: center; gap: 8px;
  font-family: var(--mono); font-size: 11.5px; color: var(--ink-dim);
  background: var(--panel); border: 1px solid var(--line);
  padding: 4px 11px; border-radius: 100px;
}
.pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--accent);
  box-shadow: 0 0 0 0 color-mix(in oklab, var(--accent) 70%, transparent);
  animation: pulse 2.4s ease-out infinite; }
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--accent) 55%, transparent); }
  70% { box-shadow: 0 0 0 7px transparent; } 100% { box-shadow: 0 0 0 0 transparent; }
}
.theme-toggle {
  cursor: pointer; background: var(--panel); color: var(--ink-dim);
  border: 1px solid var(--line); border-radius: 100px; padding: 4px 12px;
  font-family: var(--mono); font-size: 11px; letter-spacing: .04em;
  display: inline-flex; align-items: center; gap: 6px;
}
.theme-toggle:hover { color: var(--ink); border-color: var(--accent); }
.theme-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

[data-shell] > nav { background: var(--rail); border-right: 1px solid var(--line);
  padding: 12px 10px; display: flex; flex-direction: column; }
[data-shell] > nav h2 { color: var(--ink-faint); font-family: var(--mono); font-size: 10px; font-weight: 500;
  text-transform: uppercase; letter-spacing: .16em; padding: 14px 10px 6px; margin: 0; }
[data-shell] > nav ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.navitem {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 7px 11px; border-radius: 6px; color: var(--ink-dim);
  font-family: var(--mono); font-size: 12.5px; border: 0;
  background: transparent; cursor: pointer; text-align: left;
}
.navitem:hover { background: color-mix(in oklab, var(--ink) 6%, transparent); color: var(--ink); }
.navitem:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.navitem.on { background: var(--panel-2); color: var(--ink); font-weight: 600; }
.navitem .ico { width: 15px; height: 15px; color: var(--ink-faint); flex: none;
  display: inline-flex; align-items: center; justify-content: center; }
.navitem.on .ico { color: var(--accent); }
.navitem .n { margin-left: auto; font-size: 11px; color: var(--ink-faint);
  font-variant-numeric: tabular-nums; }
.navitem .dot { margin-left: auto; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.navitem .n.crit { color: var(--crit); }
[data-shell] > nav > footer { margin-top: auto; padding: 10px;
  border-top: 1px solid var(--line-soft); color: var(--ink-faint);
  font-family: var(--mono); font-size: 10.5px; line-height: 1.7; }
[data-shell] > nav > footer dl { display: grid; grid-template-columns: auto 1fr; gap: 0 6px; }
[data-shell] > nav > footer dt { color: var(--ink-dim); }
[data-shell] > nav > footer dd { overflow-wrap: anywhere; }

main { padding: 16px 18px 20px; min-width: 0; }
main > header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
main > header h1 { margin: 0; font-family: var(--mono); font-size: 15px; letter-spacing: .01em; font-weight: 600; }
main > header .sub { color: var(--ink-dim); font-family: var(--mono); font-size: 11.5px; }
.planpicker { font-family: var(--mono); font-size: 11.5px; color: var(--ink);
  background: var(--panel-2); border: 1px solid var(--line); border-radius: var(--r);
  padding: 3px 8px; max-width: 46ch; cursor: pointer; }
.planpicker:hover { border-color: var(--accent); }
.planpicker:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

main > dl { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 0 0 16px; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); padding: 11px 13px; }
.stat .lbl { font-family: var(--mono); font-size: 9.5px; text-transform: uppercase;
  letter-spacing: .13em; color: var(--ink-faint); }
.stat .val { font-family: var(--mono); font-size: 18px; font-weight: 600; margin: 5px 0 0;
  font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
.stat .val small { font-size: 11px; color: var(--ink-dim); font-weight: 500; }
.stat .val.ok { color: var(--good); }
.stat .val.crit { color: var(--crit); }

.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-lg); overflow: hidden; }
.card + .card { margin-top: 14px; }
.card > header {
  display: flex; align-items: center; gap: 10px; padding: 12px 14px;
  border-bottom: 1px solid var(--line-soft); background: color-mix(in oklab, var(--panel-2) 55%, var(--panel));
}
.card > header h2 { margin: 0; font-family: var(--mono); font-size: 12.5px; letter-spacing: .02em; font-weight: 600; }
.card > header .meta { margin-left: auto; font-family: var(--mono); font-size: 11px; color: var(--ink-dim);
  font-variant-numeric: tabular-nums; }
.card .pad { padding: 14px; }

.tbl { width: 100%; border-collapse: collapse; font-family: var(--mono); font-size: 11.5px; }
.tbl th { text-align: left; color: var(--ink-faint); font-weight: 500; font-size: 9.5px;
  text-transform: uppercase; letter-spacing: .12em; padding: 8px 14px; border-bottom: 1px solid var(--line-soft); }
.tbl th.r, .tbl td.r { text-align: right; font-variant-numeric: tabular-nums; }
.tbl td { padding: 8px 14px; border-bottom: 1px solid var(--line-soft); color: var(--ink-dim); }
.tbl tr:last-child td { border-bottom: 0; }
.tbl td.path { color: var(--ink); }
.tbl td.idx { color: var(--ink-faint); }
.tbl .note { color: var(--ink-faint); }
.tbl tr.running td { background: color-mix(in oklab, var(--accent) 6%, transparent); }
.tbl tr:hover .rowbtn { color: var(--accent); }
.rowbtn { border: 0; background: transparent; padding: 0; cursor: pointer; text-align: left;
  color: var(--ink); font-family: var(--mono); font-size: 11.5px; }
.rowbtn:hover { color: var(--accent); }
.rowbtn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

ul { list-style: none; margin: 0; padding: 0; }
dl, dd { margin: 0; }
.vrow { display: grid; grid-template-columns: auto 1fr; gap: 3px 11px; padding: 11px 0; border-bottom: 1px solid var(--line-soft); }
.vrow:last-child { border-bottom: 0; }
.vstripe { grid-row: 1 / span 2; width: 3px; border-radius: 3px; align-self: stretch; }
.vstripe.crit { background: var(--crit); }
.vstripe.warn { background: var(--warn); }
.vhead { display: flex; align-items: center; gap: 8px; margin: 0;
  font-family: var(--mono); font-size: 12px; }
.vhead .file { color: var(--ink); }
.vhead .rule { margin-left: auto; color: var(--ink-dim); font-size: 10.5px; }
.vmsg { margin: 0; font-size: 11.5px; color: var(--ink-dim); font-family: var(--sans); }
.sev { font-size: 9.5px; text-transform: uppercase; letter-spacing: .1em; padding: 1px 6px; border-radius: 4px; font-family: var(--mono); }
.sev.crit { color: var(--crit); background: var(--crit-soft); }
.sev.warn { color: var(--warn); background: var(--warn-soft); }

.chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 100px;
  font-size: 10.5px; letter-spacing: .02em; border: 1px solid transparent; font-family: var(--mono); }
.chip .d { width: 6px; height: 6px; border-radius: 50%; }
.chip.done { color: var(--good); background: var(--good-soft); border-color: color-mix(in oklab, var(--good) 30%, transparent); }
.chip.done .d { background: var(--good); }
.chip.run { color: var(--accent); background: var(--accent-soft); border-color: color-mix(in oklab, var(--accent) 35%, transparent); }
.chip.run .d { background: var(--accent); animation: blink 1.3s steps(2) infinite; }
.chip.fail { color: var(--crit); background: var(--crit-soft); border-color: color-mix(in oklab, var(--crit) 35%, transparent); }
.chip.fail .d { background: var(--crit); }
.chip.idle { color: var(--idle); background: var(--idle-soft); border-color: color-mix(in oklab, var(--idle) 30%, transparent); }
.chip.idle .d { background: var(--idle); }
@keyframes blink { to { opacity: .35; } }

.morerow td { text-align: center; color: var(--ink-faint); padding: 7px; }

.budget { display: flex; align-items: flex-end; gap: 14px; margin: 0; }
.budget figure { margin: 0; font-family: var(--mono); }
.budget .big { display: block; font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.budget .cap { color: var(--ink-faint); font-size: 10px; text-transform: uppercase; letter-spacing: .12em; margin-top: 2px; }
.budget .cost { margin-left: auto; text-align: right; }
.budget .cost .big { font-size: 16px; color: var(--good); }
.budget .cost .cap { letter-spacing: .1em; }

.herd-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 18px;
  align-items: start;
}
.herd-group { min-width: 0; }
.herd-group-title {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  margin: 0 0 6px; padding: 0 0 4px;
  border-bottom: 1px solid var(--line-soft);
  font-family: var(--mono); font-size: 10px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .12em; color: var(--ink-faint);
}
.herd-group-count { font-variant-numeric: tabular-nums; color: var(--ink-soft); }

.role-row { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line-soft); font-family: var(--mono); font-size: 11.5px; }
.role-row:last-child { border-bottom: 0; }
.role-row .rid { color: var(--ink); width: 122px; }
.role-row .arr { color: var(--ink-faint); }
.role-row .model { color: var(--ink-dim); }
.role-row .ok { margin-left: auto; color: var(--good); display: inline-flex; align-items: center; gap: 5px; }
.role-row .ok.warn { color: var(--warn); }
.role-row .ok.crit { color: var(--crit); }

.card.scope { margin-bottom: 2rem; }
.scope-grab { display: flex; gap: 8px; margin-bottom: 12px; }
.scope-route { flex: 1; font-family: var(--mono); font-size: 11.5px; padding: 5px 10px;
  border-radius: var(--r); border: 1px solid var(--line); background: var(--panel-2); color: var(--ink); }
.scope-route:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.scope-route:disabled { opacity: .5; cursor: not-allowed; }
.scope-recent { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.scope-recent li { display: flex; align-items: center; gap: 4px; }
.scope-recent-item { flex: 1; min-width: 0; text-align: left; font-family: var(--mono); font-size: 11px;
  padding: 6px 10px; border-radius: var(--r); border: 1px solid var(--line-soft); background: var(--panel-2);
  color: var(--ink-dim); cursor: pointer; display: flex; align-items: center; gap: 8px; }
.scope-remove { flex-shrink: 0; padding: 4px 7px; border-radius: var(--r); border: 1px solid transparent;
  background: none; color: var(--ink-faint); font-size: 11px; cursor: pointer; }
.scope-remove:hover { color: var(--crit); border-color: var(--line); }
.scope-recent-item:hover:not([disabled]) { color: var(--ink); border-color: var(--line); }
.scope-recent-item:active:not([disabled]) { transform: translateY(1px); }
.scope-recent-item[disabled] { opacity: .5; cursor: not-allowed; }
.scope-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
  background: var(--ink-faint); opacity: .4; }
.scope-dot.here { background: var(--good); opacity: 1;
  box-shadow: 0 0 6px color-mix(in oklab, var(--good) 80%, transparent); }

.btn { font-family: var(--mono); font-size: 11px; padding: 5px 12px; border-radius: var(--r);
  border: 1px solid var(--line); background: var(--panel-2); color: var(--ink-dim); cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px; }
.btn.pri { background: color-mix(in oklab, var(--accent) 18%, var(--panel)); color: var(--accent);
  border-color: color-mix(in oklab, var(--accent) 45%, transparent); }
.btn:hover { color: var(--ink); }
.btn.pri:hover { background: color-mix(in oklab, var(--accent) 28%, var(--panel)); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn:active:not([disabled]) { transform: translateY(1px); }
.btn[disabled] { opacity: .5; cursor: not-allowed; }
.btn[disabled]:hover { color: var(--ink-dim); }

.push { margin-left: auto; }
.gap { margin-left: 8px; }

.vh { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--line); margin-bottom: 12px; }
.tab { font-family: var(--mono); font-size: 12px; color: var(--ink-dim); background: transparent;
  border: 0; border-bottom: 2px solid transparent; padding: 8px 13px; cursor: pointer; margin-bottom: -1px;
  display: inline-flex; align-items: center; gap: 7px; }
.tab:hover { color: var(--ink); }
.tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.tab.on { color: var(--ink); border-bottom-color: var(--accent); }
.tab .badge { font-size: 10px; color: var(--ink-faint); font-variant-numeric: tabular-nums; }
.tab .live { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }

.runbar { display: flex; align-items: center; gap: 12px; padding: 9px 13px; margin-bottom: 14px;
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--r);
  font-family: var(--mono); font-size: 11px; color: var(--ink-dim); flex-wrap: wrap; }
.runbar .mini { flex: 1; height: 6px; border-radius: 100px; background: var(--idle-soft); overflow: hidden;
  display: flex; border: 1px solid var(--line-soft); min-width: 80px; }
.runbar .mini i { display: block; height: 100%; }
.runbar b { color: var(--ink); font-variant-numeric: tabular-nums; }
.runbar .k { color: var(--ink-faint); }

.authorgrid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; align-items: stretch; }
.authorside { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.authorside .card + .card { margin-top: 0; }
pre { margin: 0; padding: 8px 0 10px; overflow-x: auto; counter-reset: ln; color: var(--ink-dim);
  font-family: var(--mono); font-size: 11.5px; line-height: 1.7; }
pre:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
pre .row { display: block; white-space: pre; padding-right: 14px; }
pre .row::before { counter-increment: ln; content: counter(ln);
  display: inline-block; width: 26px; margin-right: 14px; text-align: right;
  color: var(--ink-faint); opacity: .55; }
pre .row.hl { background: color-mix(in oklab, var(--accent) 9%, transparent); }
pre .k { color: var(--tok-key); } pre .s { color: var(--tok-str); }
pre .c { color: var(--ink-faint); font-style: italic; }
pre .f { color: var(--tok-fn); } pre .p { color: var(--ink-faint); }
pre .i { color: var(--accent); }

.preview { display: flex; flex-direction: column; }
.scrub { display: flex; align-items: center; gap: 8px; padding: 9px 14px;
  border-bottom: 1px solid var(--line-soft); font-family: var(--mono); font-size: 11px; }
.scrub .arw { width: 22px; height: 22px; display: grid; place-items: center; cursor: pointer;
  border: 1px solid var(--line); border-radius: 5px; background: var(--panel-2); color: var(--ink-dim); }
.scrub .arw:hover { color: var(--ink); border-color: var(--accent); }
.scrub .arw:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.scrub .mno { color: var(--ink); font-variant-numeric: tabular-nums; }
.scrub .slug { margin-left: auto; color: var(--accent); }
.brieftext { padding: 13px 15px; font-family: var(--mono); font-size: 11px; line-height: 1.75;
  color: var(--ink-dim); white-space: pre-wrap; flex: 1; margin: 0;
  width: 100%; border: 0; background: transparent; resize: vertical; min-height: 150px; }
.brieftext:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.doctorbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px;
  padding: 11px 14px; margin-top: 14px; background: var(--rail);
  border: 1px solid var(--line); border-radius: var(--r); font-family: var(--mono); font-size: 11px; }
.doctorbar .lead { color: var(--accent); font-weight: 600; font-size: 11px; margin: 0; }
.doctorbar ul { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; }
.chk { display: inline-flex; align-items: center; gap: 6px; color: var(--ink-dim); }
.chk .ok, .chk .bad, .chk .mut { display: inline-flex; align-items: center; }
.chk .ok { color: var(--good); }
.chk .bad { color: var(--crit); }
.chk .mut { color: var(--ink-faint); }
.chk b { color: var(--ink); font-variant-numeric: tabular-nums; }
.doctorbar .acts { margin: 0 0 0 auto; display: flex; gap: 8px; }

.cmdbar { margin-top: 14px; display: flex; align-items: center; gap: 12px; padding: 10px 14px;
  background: var(--rail); border: 1px solid var(--line); border-radius: var(--r);
  font-family: var(--mono); font-size: 11px; color: var(--ink-faint); overflow-x: auto; }
.cmdbar-live { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ink-dim);
  cursor: pointer; user-select: none; }
.cmdbar-live input { accent-color: var(--accent); }
.cmdbar kbd { background: var(--panel); border: 1px solid var(--line); border-bottom-width: 2px;
  border-radius: 5px; padding: 1px 6px; color: var(--ink-dim); font-family: var(--mono); font-size: 10.5px; }
.cmdbar .sep { color: var(--line); }

.placeholder { margin: 0; padding: 40px 14px; text-align: center; color: var(--ink-faint);
  font-family: var(--mono); font-size: 12px; }
.placeholder svg { vertical-align: -2px; }

.banner { display: flex; align-items: center; gap: 10px; padding: 9px 13px; margin: 0 0 14px;
  background: var(--crit-soft); border: 1px solid color-mix(in oklab, var(--crit) 45%, transparent);
  border-radius: var(--r); color: var(--crit); font-family: var(--mono); font-size: 11px; }
.banner .lead { font-weight: 600; }
.banner .detail { color: var(--ink-dim); }

.card dl { display: grid; grid-template-columns: 108px 1fr; gap: 6px 12px;
  font-family: var(--mono); font-size: 11.5px; }
.card dt { color: var(--ink-faint); }
.card dd { color: var(--ink); overflow-wrap: anywhere; }

.srcline { display: flex; align-items: center; gap: 8px; padding: 9px 0 0;
  margin: 10px 0 0; border-top: 1px solid var(--line-soft); font-family: var(--mono);
  font-size: 10.5px; color: var(--ink-faint); flex-wrap: wrap; }
.srcline code { color: var(--sem-flag); overflow-wrap: anywhere; }

.treeselect { position: relative; width: 100%; }
.treetrigger { display: flex; align-items: center; justify-content: space-between; width: 100%;
  padding: 7px 11px; border: 1px solid var(--line); border-radius: var(--r);
  background: var(--panel-2); color: var(--ink-dim); font-family: var(--mono); font-size: 11.5px;
  cursor: pointer; text-align: left; }
.treetrigger:hover:not(:disabled) { color: var(--ink); border-color: var(--accent); }
.treetrigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.treetrigger[disabled] { opacity: .6; cursor: progress; }
.treeselect .pathlabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.treeselect .chevron { flex-shrink: 0; margin-left: 8px; color: var(--ink-faint);
  transition: transform .2s ease; }
.treeselect .chevron.open { transform: rotate(180deg); }

.treedropdown { position: fixed; z-index: 60;
  max-height: 280px; overflow-y: auto; padding: 4px 0;
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--r);
  box-shadow: 0 14px 34px -18px rgba(0,0,0,.75); }
.treerow { display: flex; align-items: center; gap: 7px; padding: 3px 8px;
  font-family: var(--mono); font-size: 11.5px; color: var(--ink-dim); }
.treerow:hover { background: color-mix(in oklab, var(--accent) 6%, transparent); }
.treerow .ico { display: inline-flex; color: var(--ink-faint); }
.treerow .nodename { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.treebox { accent-color: var(--accent); width: 13px; height: 13px; flex-shrink: 0; cursor: pointer; }
.treebox:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.treetoggle { display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0;
  border: 0; background: transparent; padding: 0; cursor: pointer; text-align: left;
  color: var(--ink); font-family: var(--mono); font-size: 11.5px; }
.treetoggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.chips .chip { cursor: pointer; border-color: color-mix(in oklab, var(--idle) 30%, transparent); }
.chips .chip:hover { color: var(--ink); border-color: var(--accent); }
.chips .chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

@media (max-width: 860px) {
  .authorgrid { grid-template-columns: 1fr; }
  main > dl { grid-template-columns: repeat(2, 1fr); }
  [data-shell] { grid-template-columns: 1fr; }
  [data-shell] > nav { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .pulse, .chip.run .d { animation: none; }
}

/* ── ported essentials: tooltip ─────────────────────────────── */
.tt-wrap { display: inline-flex; }
.tooltip { position: fixed; z-index: 3000; max-width: 250px; pointer-events: none;
  padding: 6px 9px; background: var(--panel-2); color: var(--ink);
  border: 1px solid var(--line); border-radius: var(--r);
  font-family: var(--mono); font-size: 11px; line-height: 1.45;
  box-shadow: 0 10px 28px -10px rgba(0,0,0,.6); }

/* ── ported essentials: select ──────────────────────────────── */
.selectwrap { position: relative; display: inline-block; }
.selecttrigger { display: inline-flex; align-items: center; gap: 8px; min-width: 190px; max-width: 340px;
  padding: 5px 10px; background: var(--panel-2); color: var(--ink); border: 1px solid var(--line);
  border-radius: var(--r); font-family: var(--mono); font-size: 12px; cursor: pointer; text-align: left; }
.selecttrigger:hover { border-color: var(--accent); }
.selecttrigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.selecttrigger[disabled] { opacity: .5; cursor: not-allowed; }
.selecttrigger .selectlabel { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--sem-concept); }
.selecttrigger .chevron { color: var(--ink-faint); transition: transform .15s; flex: none; }
.selecttrigger .chevron.open { transform: rotate(180deg); }
.selectdropdown { position: absolute; top: calc(100% + 4px); left: 0; z-index: 2500;
  min-width: 100%; max-height: 260px; overflow-y: auto; background: var(--panel);
  border: 1px solid var(--line); border-radius: var(--r); box-shadow: 0 12px 32px -12px rgba(0,0,0,.6); }

/* Themed thin scrollbars, the Ikuisuus 6px pattern in PAW's palette: transparent
   track, line-colour thumb; Firefox uses the same via scrollbar-color. */
.treedropdown, .selectdropdown, .modal, pre, .brieftext, .herd-groups {
  scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
.treedropdown::-webkit-scrollbar, .selectdropdown::-webkit-scrollbar,
.modal::-webkit-scrollbar, pre::-webkit-scrollbar,
.brieftext::-webkit-scrollbar, .herd-groups::-webkit-scrollbar {
  width: 6px; height: 6px; }
.treedropdown::-webkit-scrollbar-track, .selectdropdown::-webkit-scrollbar-track,
.modal::-webkit-scrollbar-track, pre::-webkit-scrollbar-track,
.brieftext::-webkit-scrollbar-track, .herd-groups::-webkit-scrollbar-track {
  background: transparent; }
.treedropdown::-webkit-scrollbar-thumb, .selectdropdown::-webkit-scrollbar-thumb,
.modal::-webkit-scrollbar-thumb, pre::-webkit-scrollbar-thumb,
.brieftext::-webkit-scrollbar-thumb, .herd-groups::-webkit-scrollbar-thumb {
  background-color: var(--line); border-radius: 3px; }
.treedropdown:hover, .selectdropdown:hover { scrollbar-color: var(--ink-faint) transparent; }
.treedropdown:hover::-webkit-scrollbar-thumb, .selectdropdown:hover::-webkit-scrollbar-thumb {
  background-color: var(--ink-faint); }
.selectsearch { width: 100%; box-sizing: border-box; padding: 7px 10px; background: var(--panel-2);
  color: var(--ink); border: 0; border-bottom: 1px solid var(--line-soft); font-family: var(--mono); font-size: 12px; }
.selectdropdown ul { list-style: none; margin: 0; padding: 4px; }
.selectoption { padding: 6px 9px; border-radius: 5px; color: var(--ink-dim); cursor: pointer;
  font-family: var(--mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.selectoption.hl { background: var(--panel-2); color: var(--ink); }
.selectoption[aria-selected="true"] { color: var(--accent); }
.selectempty { padding: 10px; text-align: center; color: var(--ink-faint); font-family: var(--mono); font-size: 11px; }
@media (prefers-reduced-motion: reduce) { .selecttrigger .chevron { transition: none; } }

/* ── ported essentials: toast ───────────────────────────────── */
.toaster { position: fixed; z-index: 4000; display: flex; flex-direction: column; gap: 8px;
  padding: 14px; max-width: 360px; pointer-events: none; }
.toaster.top-right { top: 0; right: 0; }
.toaster.top-left { top: 0; left: 0; }
.toaster.bottom-right { bottom: 0; right: 0; flex-direction: column-reverse; }
.toaster.bottom-left { bottom: 0; left: 0; flex-direction: column-reverse; }
.toast { pointer-events: auto; display: flex; gap: 9px; align-items: flex-start; padding: 10px 12px;
  background: var(--panel-2); border: 1px solid var(--line); border-left-width: 3px; border-radius: var(--r);
  box-shadow: 0 12px 32px -12px rgba(0,0,0,.6); font-family: var(--mono); font-size: 12px;
  animation: toast-in .25s ease; }
.toast.info { border-left-color: var(--accent); } .toast.info .toast-ico { color: var(--accent); }
.toast.success { border-left-color: var(--good); } .toast.success .toast-ico { color: var(--good); }
.toast.warning { border-left-color: var(--warn); } .toast.warning .toast-ico { color: var(--warn); }
.toast.error { border-left-color: var(--crit); } .toast.error .toast-ico { color: var(--crit); }
.toast.exiting { animation: toast-out .2s ease forwards; }
.toast-ico { flex: none; margin-top: 1px; }
.toast-body { flex: 1; min-width: 0; }
.toast-title { margin: 0 0 2px; color: var(--ink); font-weight: 600; }
.toast-msg { margin: 0; color: var(--ink-dim); line-height: 1.4; overflow-wrap: anywhere; }
.toast-x { flex: none; background: transparent; border: 0; color: var(--ink-faint); cursor: pointer;
  padding: 2px; border-radius: 4px; display: inline-flex; }
.toast-x:hover { color: var(--ink); }
.toast-x:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
@keyframes toast-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
@keyframes toast-out { to { opacity: 0; transform: translateY(-8px); } }
@media (prefers-reduced-motion: reduce) { .toast, .toast.exiting { animation: none; } }

/* ── ported essentials: modal ───────────────────────────────── */
.modal-overlay { position: fixed; inset: 0; z-index: 3500; display: grid; place-items: center; padding: 24px;
  background: color-mix(in oklab, var(--desk) 72%, transparent); }
.modal { width: 100%; max-height: calc(100vh - 48px); overflow: auto; background: var(--panel);
  border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: 0 40px 80px -30px rgba(0,0,0,.7);
  animation: modal-in .2s ease; }
.modal-sm { max-width: 400px; } .modal-md { max-width: 560px; } .modal-lg { max-width: 820px; }
.modal:focus-visible { outline: none; }
.modal-head { display: flex; align-items: center; gap: 12px; padding: 14px 16px;
  border-bottom: 1px solid var(--line-soft); }
.modal-head h2 { margin: 0; flex: 1; font-family: var(--mono); font-size: 13px; letter-spacing: .02em; color: var(--ink); }
.modal-x { background: transparent; border: 0; color: var(--ink-faint); cursor: pointer; padding: 4px;
  border-radius: 5px; display: inline-flex; }
.modal-x:hover { color: var(--ink); }
.modal-x:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.modal-body { padding: 16px; color: var(--ink-dim); font-family: var(--sans); font-size: 13px; line-height: 1.5; }
@keyframes modal-in { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .modal { animation: none; } }
`;
