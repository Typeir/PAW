# Part 12: The Console and the Daemon

> `pawd` reads the real machine and serves it; the React console renders what it is told and nothing
> more. One contract between them, one direction of dependency, and no fabricated numbers on either
> side.

---

## Overview

```
  packages/daemon (pawd)                          packages/gui (the console)
  ┌───────────────────────────────┐               ┌────────────────────────────────┐
  │ nodeRuntime  fs · import ·    │               │ main.tsx  boot + createRoot    │
  │              ps-list · https  │               │   ↓                            │
  │              ws (upgrade)     │   GET /       │ infrastructure/snapshotSource  │
  │      ↓ injected               │ ───────────▶  │   __PAW_DATA__ ?? fetch(/api)  │
  │ serve.ts     runDaemon()      │               │ infrastructure/liveSocket      │
  │   ├─ identity  CA · leaf      │  GET /api/    │   ↓ the only `new WebSocket`   │
  │   ├─ bus       typed pub/sub  │ ◀─── state ── │ application/hydrateSnapshot    │
  │   ├─ cache     slice + compose│   (boot,      │ application/applyLiveEvent     │
  │   ├─ sources   diff & publish │    degraded)  │   ↓ ConsoleData                │
  │   ├─ sessions  auth machine   │  wss /live    │ hooks/useLiveWire (state m/c)  │
  │   └─ router    token gate     │ ◀══ frames ══ │ domain/consoleState (reducer)  │
  └───────────────────────────────┘   on change   │   ↓ context                    │
              ▲                                   │ presentation/ atoms · views    │
              │ PawSnapshot + LiveEnvelope        └────────────────────────────────┘
              └───────────────────────────────────┘
```

`PawSnapshot` lives in `core/src/contracts.ts` and is types-only. It is deliberately plain data: a
plan's `brief(args, member)` is pre-rendered to a `briefs` array before it crosses the wire, so
nothing needs a live closure on the consumer side.

The transport is **TLS and a WebSocket, not polling**. The console opens one `wss://` connection,
authenticates on the first frame, and receives a slice whenever one changes. Polling survives only
as the degraded mode inside the provider, so a socket that will not open is slower rather than
broken. Part 13 is the wire itself: the certificates, the gates, the frames, and the reasoning
behind each. This part stays about the shape of the two halves.

## One console per repository, not per plan

`pawd` serves a **repository**. At boot it walks the root it was given, finds `.paw/config.json` if
the repo has one, and lists every `*.swarm.mjs`. Which plan is in view is a **selection carried on the
request** — `GET /api/state?plan=plans/lore.swarm.mjs` — so a workspace with twenty plans needs one
console, not twenty daemons.

| Concern   | How                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| Discovery | `discoverPlans(listing)` — a filename question; nothing is imported until it is picked                        |
| Selection | `?plan=` per request; `selectPlan` refuses any path the daemon did not itself discover (404)                  |
| Freshness | a picked plan is imported once and cached against its **mtime**; editing the file reloads it on the next poll |
| No plan   | `selectedPlan: null` and an empty plan — the console offers the picker rather than an empty Plan tab          |
| No config | `configPath: ''` — the doctor reports every missing key instead of the daemon inventing one                   |

Because a plan module is code, this matters: nothing in the repository is executed until an operator
picks it, and a query string can never reach a module outside the served root.

## Two shells, one console — and no costume

The same bundle runs in a browser tab and in the desktop shell, and it asks which
one it is in rather than guessing:

|               | Browser tab                                | Desktop shell                                      |
| ------------- | ------------------------------------------ | -------------------------------------------------- |
| Window chrome | **none** — it owns no window               | traffic lights that really close/minimise/maximise |
| Layout        | a page: full width, no border, no shadow   | a window: max-width, rounded, shadowed             |
| Titlebar      | a plain bar (wordmark, daemon pill, theme) | the same bar, and it **drags the window**          |

The signal is the preload's bridge: `windowControls(window)` returns controls only when
`window.paw` exposes all three as functions, and `detectShell` reports `desktop` only then. A light is
therefore drawn only where pressing it does something — a painted traffic light on a web page is a
costume, and the previous version wore one in _both_ shells (Electron kept its OS frame and drew a
second, fake one underneath).

The Electron window is `frame: false`, the titlebar carries `-webkit-app-region: drag`, and the three
actions travel one narrow IPC channel (`paw:window`) that accepts `minimize | maximize | close` and
throws on anything else.

> **Build trap.** The `import.meta.url` banner that makes `@paw/daemon` work in the CommonJS _main_
> bundle must not be applied to the preload: a sandboxed preload may `require` nothing but `electron`,
> so `require("node:url")` kills it — and a dead preload means no bridge, no window controls, and not
> a single line of error in the terminal. `build.mjs` applies it to the main process only.

## The daemon is a library, not a process

`runDaemon(options, runtime)` takes every effect it needs through `DaemonRuntime` — read a file,
import a plan, list processes, read the host, bind a socket, schedule a poll. That is what lets three
callers run the same daemon:

| Caller   | How                                                       |
| -------- | --------------------------------------------------------- |
| `pawd`   | `daemon/src/main.ts` — argv shell, prints the URL         |
| `paw ui` | in the CLI's own process, so there is one process to kill |
| Electron | in the main process, window loads the URL it returns      |

and it is what lets the whole sequence be unit-tested with no socket. `nodeRuntime.ts` is the one
file that touches the outside world, and a real-socket integration test covers it — no coverage
exclusion.

## What is real

Every number the console shows is read, not invented:

- **host** — `process` and `os` at the moment of the request. The snapshot is a thunk the router
  calls per request, so uptime climbs and resident memory moves while you watch.
- **processes** — `ps-list`, narrowed by `collectSubtree(all, process.pid)` to the daemon and the
  workers it spawned. The full host table is never served.
- **plan / doctor** — real `runDoctor`, `doctorPlan`, `renderBrief`, `planKey` from `@paw/core`.
- **run / budget** — only when a dispatcher was supplied (`paw ui --run`). Outcomes come from
  `dispatchSwarm`; tokens are counted by `meterPort` wrapping the port the run actually calls.
  `spendUsd` stays 0 because no price list crosses this boundary. The run reports itself **as it
  happens**: `dispatchSwarm` emits a `DispatchEvent` when each member starts and settles, `trackRun`
  folds those into `RunProgress`, and the daemon publishes each one. A four-hundred-member run
  against a real provider therefore fills in member by member instead of staying blank for minutes,
  which is indistinguishable from a console that has hung.
- **everything else** — zeros and empty lists, which is the truth about a run that has not happened.

Nothing expensive is recomputed to answer a read. `cache.ts` renders a plan's briefs, slugs and
findings **once per version of its file** and `composeSnapshot` assembles the cached parts; the old
`buildSnapshot`, which re-rendered every brief on every request, was deleted rather than left beside
its replacement. Two builders for one shape is how a console starts showing different data depending
on which path produced it.

## The console's layers

```
domain/          console.types · plan · consoleState        pure, no React
application/     hydrateSnapshot · applyLiveEvent           React, no markup
                 context · hooks · useLiveWire
infrastructure/  snapshotSource · liveSocket · auth         fetch / socket / injected data
presentation/    atoms · chrome · views · styles · lib      markup only
main.tsx                                                    boot shell (coverage-excluded)
```

`applyLiveEvent` is the twin of `hydrateSnapshot`: hydration maps a whole snapshot into
`ConsoleData`, and this maps one topic's new value onto the data already held. A slice **replaces**,
never merges, so the console cannot end up holding half of an old plan and half of a new one, and a
topic it has no arm for changes nothing at all — which is what lets a newer daemon talk to an older
console without corrupting it.

State and dispatch live in two contexts, so a panel reads exactly the slice it needs through a hook
(`usePlan()`, `useMember()`, `useConsoleActions()`) and no component takes a prop it does not own.
Adding a subsystem is a case in `sectionOutlet.tsx` and a view; adding a control is an atom.

## Attached context — one seam, two faces

A plan can declare files whose contents ride along with a member's brief:

```ts
// in a .swarm.mjs plan — pure, per-member, like expectFiles
contextFiles: (args, member) => ['docs/house-style.md', args.rows[member].spec],
```

Nothing in the domain reads those files. `dispatchSwarm` resolves them at dispatch
through `FileReaderPort`, and `composeBrief` assembles the prompt — the brief, then each
file fenced under `### <path>` beneath a `## Attached context` heading. `paw swarm show`
calls the same `composeBrief`, so the dry-run is exactly what the model receives.

```
  console                       CLI
  FileTreeSelect (multi)        paw swarm run … --context a.ts,src/**
        │ GET /api/tree               │ globs expanded against the same walk
        ▼                             ▼
   selection ──▶ --context ─────▶ withContext(plan, paths)
                                      │
                                      ▼   SwarmPlan.contextFiles
                                 dispatchSwarm ──▶ composeBrief ──▶ FileReaderPort
```

The reader is rooted: `createNodeFileReader(root)` resolves every path inside that root,
refuses to climb out of it, and refuses `.env*` outright — a selection that arrived from a
browser cannot reach the rest of the machine, and secrets never end up in a prompt.

`GET /api/tree` serves the repository the daemon was pointed at (`--root`, default the
working directory), pruned of `.git`, `node_modules`, `dist`, `coverage`, `.next`, and
`.turbo`. `?root=` narrows **within the tree the daemon already built**, so no request can
name a path on disk that the daemon did not choose to list.

## Three pages, one bundle

`gui/build.mjs` emits the same React bundle three ways:

| File                 | Snapshot                     | `connect-src` | Used by                   |
| -------------------- | ---------------------------- | ------------- | ------------------------- |
| `dist/index.html`    | injected demo                | `'none'`      | opening the file directly |
| `dist/artifact.html` | injected demo                | (host's)      | publishing                |
| `dist/live.html`     | **none** — the shell fetches | `'self'`      | served by `pawd`          |

The static page says it is static: the daemon pill reads idle, Overview says `no daemon attached`,
and the process table is empty rather than populated with a plausible fiction.

## Failing loud

- A snapshot whose `memberTotal` disagrees with its `briefs`/`slugs` throws at hydration — over the
  socket exactly as over HTTP, because `hello` goes through the same door.
- A missing brief for a scrubbed member throws rather than rendering a blank editor.
- The wire down paints an amber `live wire down — polling` status with a reconnect button; a refused
  credential paints a red `credential refused` alert naming the one thing that fixes it. They are
  separate states because retrying fixes the first and never fixes the second.
- A failed run rejects `daemon.dispatched`; `paw ui` prints it and exits non-zero. The rejection is
  claimed the moment it is created, so a run that fails before the caller can attach a handler does
  not take the process down with it.
- The daemon's model port refuses to complete anything — `pawd` reports, it does not dispatch.
- A missing `gui/dist/live.html` degrades to the bootstrap page **and says so on stderr**.
- A source that throws is reported to the terminal _and_ published on the `log` topic, because a
  console cannot read stderr and a failure reported only to a terminal nobody is watching has been
  reported to nobody. The ring is bounded at 200 lines and says how many it dropped.
- A daemon that cannot load its TLS identity does not start. There is no plaintext fallback.

## Running it

```bash
# the console over a live daemon — serves the repo you are standing in
cd .github/PAW
node bin/paw.mjs ui --port=8971
# → https://127.0.0.1:8971/#t=<credential>  · pick a plan in the console
# the fragment carries this boot's credential — treat that URL like a password

# make the browser stop warning about the local CA (per-user, never elevated)
node bin/paw.mjs trust --dry-run   # prints the exact commands and the fingerprint
node bin/paw.mjs trust

# with a real (deterministic fake-model) run behind the Herd tab
node bin/paw.mjs ui <plan.swarm.mjs> --run   # --live dispatches against the provider instead

# attach files to every brief — pick them in the console, or name them here
… swarm show <plan> 0 --context docs/style.md,src/**/*.ts   # the dry-run, as dispatched
… swarm run  <plan>   --context docs/style.md
… ui <config> <plan> --run --context docs/style.md --root=.

# the desktop shell (runs its own daemon)
cd packages/electron && npm start
```

`npm --prefix packages/gui run build` first, or the daemon serves the bootstrap page.

---

_Companion to the decision record in `.ignore/research/byoksdk/` (docs 09–19) and to
[CONSTRAINTS.md](../CONSTRAINTS.md), which this subsystem is held to: TDD at 100%, `core` as a pure
library its consumers depend on, and no silent failures._
