# Part 14: Electron — Testing Plan & Pixel Regression Plan

> The desktop shell (`packages/electron`) is the one package at 0% coverage. It owns **no domain
> logic** — it starts `pawd` in-process and pins one hardened window on the daemon's loopback TLS URL.
> So the test surface is small but load-bearing: the value is almost entirely in the **security
> posture** and the **rendered pixels**, not in behaviour. This plan splits accordingly.

---

## What the shell actually is

`main.ts` (326 lines) does five security-relevant things and nothing else:

| Concern | Function | The invariant to protect |
| --- | --- | --- |
| Launch args | `readLaunchArgs(argv)` | `--root`/`--config`/plan parsed; no arg ⇒ serve `.` |
| CSP | `cspFor(origin)` / `installCsp` | `default-src 'none'`; only the daemon origin re-granted on `connect-src` |
| Cert pin | `pinDaemonCertificate` | accept **only** the daemon's own leaf on `127.0.0.1` (`0`), reject all else (`-2`) — never defer |
| Nav lock | `lockToDaemon` | every navigate / redirect / new-window denied |
| Window bridge | `installWindowControls` (`paw:window`) | exactly `minimize`/`maximize`/`close`; anything else throws |

Plus `capture(url)` — a **`--capture` mode that already renders the console to `capture.png` and quits.**
That is the seam the pixel plan builds on; it does not need inventing.

---

## Testing plan

### Layer 1 — pure unit tests (no Electron), to 100%

Everything security-critical in `main.ts` is a *decision* wrapped in an Electron call. Extract each
decision into a pure function and unit-test it exhaustively — the same coverage bar as every other
package. This is the highest value for the least cost, and it is where the security invariants live.

- **`readLaunchArgs`** — already exported. Table-test: no args → `{root:'.'}`; `--root=`/`--config=`;
  a plan path; the `.cjs` and `-`-prefixed args filtered out.
- **`cspFor(origin)`** — export it. Assert the exact policy string; assert the **only** network grant
  is `connect-src <origin> <wss origin>` and everything else is `'none'`/`'self'`/inline. A regression
  that widens the CSP is a security regression, so pin the whole string.
- **Cert-pin verdict** — extract the callback body to `pinVerdict(request, expected, host): 0 | -2`.
  Test: exact host + exact fingerprint → `0`; wrong host → `-2`; wrong fingerprint → `-2`; both wrong
  → `-2`. There must be **no** `-3` (defer) branch — assert the function's range is `{0, -2}` only.
- **Window-action router** — extract `windowAction(action, win): void` over a minimal
  `{ minimize, maximize, unmaximize, close, isMaximized }` fake. Test each of the three actions, the
  maximize↔unmaximize toggle, the `win === null` early return, and that an unknown action **throws**.

Wire these as `packages/electron/vitest.config.ts` with the same 100% thresholds; exclude only the
thin Electron-runtime glue (`start`, `createWindow`, `installCsp`, `installWindowControls`,
`capture`, the `app.*` wiring) for the same reason `main.ts` is excluded elsewhere — it is process
shell exercised by Layer 2.

### Layer 2 — Electron integration (the posture, end to end)

Layer 1 proves the decisions; Layer 2 proves they are actually *wired* into a running Electron. Run
the real shell headlessly against a fixture repo and assert the posture from outside:

- Harness: `@electron/test`-style spawn, or Playwright's Electron support
  (`_electron.launch({ args: ['.', '--root=<fixture>'] })`). Playwright is preferred — it also drives
  the pixel plan.
- Assertions:
  - the window loads `https://127.0.0.1:<port>/…#t=<token>` (the daemon it started);
  - a response carries the CSP header from `cspFor`;
  - `will-navigate` to any other origin is prevented (attempt a nav, assert URL unchanged);
  - the cert pin **rejects** a different cert (point the window at a second TLS origin → load fails)
    and **accepts** the daemon's;
  - the `paw:window` bridge minimises/maximises/closes, and an out-of-band IPC action is refused;
  - `--capture` writes a non-empty PNG and the process exits `0`.

Keep Layer 2 small (one spec, a handful of assertions) and off the per-commit path if it is slow —
it is a posture smoke, not a coverage driver.

### Explicitly out of scope

The daemon, GUI, and identity are tested in their own tiers; the shell must not re-test them. It only
proves *it wired the hardened window to the daemon it started*.

---

## Pixel regression plan

The shell renders **live data** (host facts, process subtree, doctor, re-read per poll). Naïvely
screenshotting that is non-deterministic and will flap. The plan is therefore **determinism first,
capture second, diff third.**

### 1. Make the capture deterministic (the hard 80%)

A golden is only worth having if the same inputs always produce the same pixels. Sources of drift and
the fix for each:

| Drift source | Fix |
| --- | --- |
| Live host facts / `ps-list` / plan state | Launch `pawd` in a **fixture mode**: a frozen `PawSnapshot` (or fixture repo + stubbed host/process sources) so `/api/state` answers identically every run. The daemon already injects its runtime — add a capture-only source set. |
| Wall-clock / uptime / "N ago" strings | Inject a **frozen clock** (the daemon already threads a clock port; `identityNotice` takes a `Date`). Fixed instant ⇒ fixed strings. |
| GPU / anti-aliasing / sub-pixel | Launch with `--disable-gpu`, fixed `deviceScaleFactor: 1`, fixed viewport (1280×800 is already the window size). |
| Fonts | The console already inlines fonts as `data:` (the CSP forbids remote fonts), so text is self-contained — keep it that way; a remote-font regression would also break the CSP test. |
| Animation / spinners / caret | A capture-mode stylesheet (or `PAW_CAPTURE=1` → `prefers-reduced-motion`) that disables transitions/animations and hides the caret. |
| Settle timing (`SETTLE_MS = 1200` sleep) | Replace the fixed sleep with a **ready signal** — have the console set `document.readyState`-style marker (e.g. a `data-console-ready` attribute) once `/api/state` and `/api/tree` have both answered, and wait on that. A fixed sleep golden-images a spinner on a slow CI runner. |

### 2. Two capture surfaces

- **GUI regression (primary).** The pixels are `@paw/gui`'s (`gui/dist/live.html`). Screenshot it with
  **Playwright** (bundled Chromium → the most reproducible AA across machines) driving `pawd`'s URL in
  the fixture mode above. Cover many views cheaply: empty state, a plan open, the doctor, a degraded
  socket, an attach prompt. This is where most goldens live.
- **Shell regression (smoke).** Use the existing `electron . --capture` for the **shell-specific**
  chrome only: the frameless window, the console-drawn titlebar and its three lights, the background
  colour, the window geometry. One or two goldens — it proves the Electron frame, not the GUI content.

### 3. Diff, golden management, and the matrix

- **Diff:** `pixelmatch` or `odiff` with a small tolerance (anti-aliasing noise ≠ regression). Fail the
  job on diff ratio over threshold; upload the **diff image** as a CI artifact so a human sees *what*
  moved.
- **Canonical runner, not a matrix.** Font hinting and AA differ per OS; maintaining one golden per OS
  is a treadmill. Capture goldens on **one** runner (Linux CI recommended) and gate on it; treat other
  OSes as manual/spot checks. Playwright's bundled Chromium makes the Linux golden portable enough.
- **Update flow:** goldens are committed under `packages/electron/test/goldens/` (and gui's under its
  own). A `--update-goldens` / `PLAYWRIGHT_UPDATE_SNAPSHOTS` run regenerates them; the diff must be
  reviewed in the PR like any other change. Never auto-accept.

### 4. Phasing

1. Layer-1 unit tests + `vitest.config.ts` at 100% — closes the coverage gap, protects the posture. **Do first.**
2. Capture-mode determinism (fixture data source + frozen clock + ready signal + reduced-motion). Prerequisite for any stable golden.
3. Playwright GUI goldens for the core views + the diff gate on the canonical runner.
4. Electron `--capture` shell smoke (one golden) + the Layer-2 posture spec.

Steps 1–2 are the ones without which nothing else is trustworthy; 3–4 are the payoff.
